/*
 * Implementation of 8520 Complex Interface Adapter (CIA) in Verilog.
 * Written by Niklas Ekström in June 2021.
 *
 * Features:
 * - 2x 8-bit I/O ports (PORTA, PORTB)
 * - Handshaking for I/O port communication (PC, FLAG)
 * - 2x interval timers (TA, TB)
 * - Time of Day clock (TOD)
 * - Serial port (SDR)
 * - Interrupt control (ICR)
 * - Control Registers (CRA, CRB)
 *
 * Features that are deliberately not implemented:
 * - Outputting TA/TB underflow on PB6/7 (PBON, OUTMODE bits are stuck zero)
 * - Using CNT as source for TA/TB (INMODE bit is stuck zero)
 *
 * Features that could probably be removed to save logic elements:
 * - I don't think the TOD alarm feature is used.
 *
 * Gotchas:
 * - The polarity of shift_out_clk and the CNT signal are inverted. It seems like
 *   CNT is active low (and perhaps should have been called CNT_n).
 */

module cia(
    // Chip access control.
    input RESET_n,
    input E_CLK,
    input CS_n,
    input RW,
    input [3:0] A,
    inout [7:0] D,

    // Port A/B.
    inout [7:0] PA,
    inout [7:0] PB,

    // Handshake.
    output PC_n,
    input FLAG_n,

    // Serial port.
    inout CNT,
    inout SP,

    // TOD tick.
    input TICK,

    // Interrupt.
    output IRQ_n
    );

    localparam [3:0] REG_PRA = 4'h0;
    localparam [3:0] REG_PRB = 4'h1;
    localparam [3:0] REG_DDRA = 4'h2;
    localparam [3:0] REG_DDRB = 4'h3;
    localparam [3:0] REG_TA_LO = 4'h4;
    localparam [3:0] REG_TA_HI = 4'h5;
    localparam [3:0] REG_TB_LO = 4'h6;
    localparam [3:0] REG_TB_HI = 4'h7;
    localparam [3:0] REG_TOD_LOW = 4'h8;
    localparam [3:0] REG_TOD_MID = 4'h9;
    localparam [3:0] REG_TOD_HI = 4'ha;
    localparam [3:0] REG_B_UNUSED = 4'hb;
    localparam [3:0] REG_SDR = 4'hc;
    localparam [3:0] REG_ICR = 4'hd;
    localparam [3:0] REG_CRA = 4'he;
    localparam [3:0] REG_CRB = 4'hf;

    // Control registers.
    reg ta_running;
    reg ta_oneshot;
    reg sp_output;

    reg tb_running;
    reg tb_oneshot;
    reg tb_count_ta_underflow;
    reg tod_set_alarm;

    wire [7:0] cra = {1'b0, sp_output, 2'b00, ta_oneshot, 2'b00, ta_running};
    wire [7:0] crb = {tod_set_alarm, tb_count_ta_underflow, 2'b00, tb_oneshot, 2'b00, tb_running};

    // Port A/B.
    reg [7:0] ddra;
    reg [7:0] pra;

    reg [7:0] ddrb;
    reg [7:0] prb;

    assign PA[0] = ddra[0] ? pra[0] : 1'bz;
    assign PA[1] = ddra[1] ? pra[1] : 1'bz;
    assign PA[2] = ddra[2] ? pra[2] : 1'bz;
    assign PA[3] = ddra[3] ? pra[3] : 1'bz;
    assign PA[4] = ddra[4] ? pra[4] : 1'bz;
    assign PA[5] = ddra[5] ? pra[5] : 1'bz;
    assign PA[6] = ddra[6] ? pra[6] : 1'bz;
    assign PA[7] = ddra[7] ? pra[7] : 1'bz;

    assign PB[0] = ddrb[0] ? prb[0] : 1'bz;
    assign PB[1] = ddrb[1] ? prb[1] : 1'bz;
    assign PB[2] = ddrb[2] ? prb[2] : 1'bz;
    assign PB[3] = ddrb[3] ? prb[3] : 1'bz;
    assign PB[4] = ddrb[4] ? prb[4] : 1'bz;
    assign PB[5] = ddrb[5] ? prb[5] : 1'bz;
    assign PB[6] = ddrb[6] ? prb[6] : 1'bz;
    assign PB[7] = ddrb[7] ? prb[7] : 1'bz;

    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n) begin
            pra <= 8'd0;
            prb <= 8'd0;
            ddra <= 8'd0;
            ddrb <= 8'd0;
        end
        else if (!CS_n && !RW) begin
            case (A)
                REG_PRA: pra <= D;
                REG_PRB: prb <= D;
                REG_DDRA: ddra <= D;
                REG_DDRB: ddrb <= D;
            endcase
        end
    end

    reg pc;
    assign PC_n = pc ? 1'b0 : 1'bz;

    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            pc <= 1'b0;
        else
            pc <= !CS_n && A == REG_PRB;
    end

    reg [1:0] flag_n_sync;
    always @(negedge E_CLK)
        flag_n_sync <= {flag_n_sync[0], !FLAG_n};

    wire flag_falling = flag_n_sync[1] && !flag_n_sync[0];

    // Interval timers.
    reg [15:0] ta_counter;
    reg [15:0] tb_counter;

    reg [15:0] ta_latch;
    reg [15:0] tb_latch;

    wire ta_underflowing = ta_running && ta_counter == 16'd0;
    wire tb_underflowing = tb_running && (!tb_count_ta_underflow || ta_underflowing) && tb_counter == 16'd0;

    // Update ta_latch, tb_latch.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n) begin
            ta_latch <= 16'd0;
            tb_latch <= 16'd0;
        end
        else if (!CS_n && !RW) begin
            case (A)
                REG_TA_LO: ta_latch[7:0] <= D;
                REG_TA_HI: ta_latch[15:8] <= D;
                REG_TB_LO: tb_latch[7:0] <= D;
                REG_TB_HI: tb_latch[15:8] <= D;
            endcase
        end
    end

    // Update ta_counter.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            ta_counter <= 16'd0;
        else begin
            if (!CS_n && !RW && A == REG_CRA && D[4])
                ta_counter <= ta_latch;
            else if (!CS_n && !RW && A == REG_TA_HI && (!ta_running || ta_oneshot))
                ta_counter <= {D, ta_latch[7:0]};
            else if (ta_running) begin
                if (ta_counter == 16'd0)
                    ta_counter <= ta_latch;
                else
                    ta_counter <= ta_counter - 16'd1;
            end
        end
    end

    // Update tb_counter.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            tb_counter <= 16'd0;
        else begin
            if (!CS_n && !RW && A == REG_CRB && D[4])
                tb_counter <= tb_latch;
            else if (!CS_n && !RW && A == REG_TB_HI && (!tb_running || tb_oneshot))
                tb_counter <= {D, tb_latch[7:0]};
            else if (tb_running && (!tb_count_ta_underflow || ta_underflowing)) begin
                if (tb_counter == 16'd0)
                    tb_counter <= tb_latch;
                else
                    tb_counter <= tb_counter - 16'd1;
            end
        end
    end

    // Update ta_running.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            ta_running <= 1'b0;
        else begin
            if (!CS_n && !RW && A == REG_CRA)
                ta_running <= D[0];
            else if (!CS_n && !RW && A == REG_TA_HI && ta_oneshot)
                ta_running <= 1'b1;
            else if (ta_underflowing && ta_oneshot)
                ta_running <= 1'b0;
        end
    end

    // Update tb_running.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            tb_running <= 1'b0;
        else begin
            if (!CS_n && !RW && A == REG_CRB)
                tb_running <= D[0];
            else if (!CS_n && !RW && A == REG_TB_HI && tb_oneshot)
                tb_running <= 1'b1;
            else if (tb_underflowing && tb_oneshot)
                tb_running <= 1'b0;
        end
    end

    // Update ta_oneshot, tb_oneshot, tb_count_ta_underflow.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n) begin
            ta_oneshot <= 1'b0;
            tb_oneshot <= 1'b0;
            tb_count_ta_underflow <= 1'b0;
        end
        else if (!CS_n && !RW) begin
            if (A == REG_CRA)
                ta_oneshot <= D[3];

            if (A == REG_CRB) begin
                tb_oneshot <= D[3];
                tb_count_ta_underflow <= D[6];
            end
        end
    end

    // Time of Day clock (TOD).
    reg [23:0] tod_counter;
    reg [23:0] tod_latch;
    reg [23:0] tod_alarm;
    reg alarm_set;

    reg tod_running;
    reg tod_latched;

    reg tick_sync_1;
    reg tick_sync_2;

    // Update tod_set_alarm.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            tod_set_alarm <= 1'b0;
        else if (!CS_n && !RW && A == REG_CRB)
            tod_set_alarm <= D[7];
    end

    // Update tod_latched, tod_latch.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            tod_latched <= 1'b0;
        else if (!CS_n && RW) begin
            if (A == REG_TOD_HI) begin
                tod_latch <= tod_counter;
                tod_latched <= 1'b1;
            end
            else if (A == REG_TOD_LOW)
                tod_latched <= 1'b0;
        end
    end

    // Update alarm_set.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            alarm_set <= 1'b0;
        else if (!CS_n && !RW && tod_set_alarm && A == REG_TOD_LOW)
            alarm_set <= 1'b1;
    end

    // Update tod_alarm.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            tod_alarm <= 24'd0;
        else if (!CS_n && !RW && tod_set_alarm) begin
            case (A)
                REG_TOD_LOW: tod_alarm[7:0] <= D;
                REG_TOD_MID: tod_alarm[15:8] <= D;
                REG_TOD_HI: tod_alarm[23:16] <= D;
            endcase
        end
    end

    always @(negedge E_CLK) begin
        tick_sync_1 <= TICK;
        tick_sync_2 <= tick_sync_1;
    end

    wire tod_write = !CS_n && !RW && !tod_set_alarm && (A == REG_TOD_HI || A == REG_TOD_MID || A == REG_TOD_LOW);

    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n) begin
            tod_running <= 1'b0;
            tod_counter <= 24'd0;
        end
        else if (tod_write) begin
            case (A)
                REG_TOD_HI: tod_counter[23:16] <= D;
                REG_TOD_MID: tod_counter[15:8] <= D;
                REG_TOD_LOW: tod_counter[7:0] <= D;
            endcase
            tod_running <= A == REG_TOD_LOW;
        end
        else if (tod_running && !tick_sync_2 && tick_sync_1)
            tod_counter <= tod_counter + 24'd1;
    end

    wire alarm_equal = tod_counter == tod_alarm;

    reg prev_alarm_equal;
    always @(negedge E_CLK)
        prev_alarm_equal <= alarm_equal;

    wire alarm_fired = tod_running && alarm_set && !prev_alarm_equal && alarm_equal;

    // Serial port.
    reg [7:0] sdr_in;
    reg [7:0] shift_in;
    reg [2:0] shift_in_counter;

    wire sp_in_reset_n = RESET_n && !sp_output;

    always @(posedge CNT or negedge sp_in_reset_n) begin
        if (!sp_in_reset_n) begin
            sdr_in <= 8'd0;
            shift_in <= 8'd0;
            shift_in_counter <= 3'd0;
        end
        else begin
            shift_in <= {shift_in[6:0], SP};
            if (shift_in_counter == 3'd7)
                sdr_in <= {shift_in[6:0], SP};
            shift_in_counter <= shift_in_counter + 3'd1;
        end
    end

    // Clock domain crossing for shift_in_complete.
    reg shift_in_complete_req;
    reg shift_in_complete_ack;

    always @(posedge CNT or negedge RESET_n) begin
        if (!RESET_n)
            shift_in_complete_req <= 1'b0;
        else if (!sp_output && shift_in_counter == 3'd7)
            shift_in_complete_req <= !shift_in_complete_ack;
    end

    reg shift_in_complete;

    always @(posedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            shift_in_complete <= 1'b0;
        else
            shift_in_complete <= shift_in_complete_req != shift_in_complete_ack;
    end

    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            shift_in_complete_ack <= 1'b0;
        else if (shift_in_complete)
            shift_in_complete_ack <= shift_in_complete_req;
    end

    // Update sp_output.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            sp_output <= 1'b0;
        else if (!CS_n && !RW && A == REG_CRA)
            sp_output <= D[6];
    end

    reg [7:0] sdr_out;
    reg sdr_out_new_data;
    reg shift_out_running;
    reg [7:0] shift_out;
    reg [2:0] shift_out_counter;
    reg shift_out_clk;

    wire shift_out_complete = shift_out_running && shift_out_counter == 3'd7 && shift_out_clk && ta_underflowing;

    wire shift_complete = shift_in_complete | shift_out_complete;

    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            sdr_out <= 8'd0;
        else if (!CS_n && !RW && A == REG_SDR)
            sdr_out <= D;
    end

    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n) begin
            shift_out <= 8'd0;
            shift_out_clk <= 1'b0;
            shift_out_counter <= 3'd0;
        end
        else if (sp_output) begin
            if (!CS_n && !RW && A == REG_CRA && !D[6]) begin
                // FIXME: Should this be combined with reset handling?
                shift_out <= 8'd0;
                shift_out_clk <= 1'b0;
                shift_out_counter <= 3'd0;
            end
            else begin
                if (shift_out_running && ta_underflowing) begin
                    if (!shift_out_clk) begin
                        if (shift_out_counter == 3'd0)
                            shift_out <= sdr_out;
                        else
                            shift_out <= {shift_out[6:0], 1'b0};
                    end
                    else
                        shift_out_counter <= shift_out_counter + 3'd1;

                    shift_out_clk <= !shift_out_clk;
                end
            end
        end
    end

    // Update shift_out_running, sdr_out_new_data.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n) begin
            shift_out_running <= 1'b0;
            sdr_out_new_data <= 1'b0;
        end
        else if (sp_output) begin
            if (!CS_n && !RW && A == REG_CRA && !D[6]) begin
                // FIXME: Should this be combined with reset handling?
                shift_out_running <= 1'b0;
                sdr_out_new_data <= 1'b0;
            end
            else if (!CS_n && !RW && A == REG_SDR) begin
                if (!shift_out_running || shift_out_complete)
                    shift_out_running <= 1'b1;
                else
                    sdr_out_new_data <= 1'b1;
            end
            else if (shift_out_complete) begin
                if (!sdr_out_new_data)
                    shift_out_running <= 1'b0;
                else
                    sdr_out_new_data <= 1'b0;
            end
        end
    end

    assign SP = sp_output && !shift_out[7] ? 1'b0 : 1'bz;
    assign CNT = sp_output && shift_out_clk ? 1'b0 : 1'bz;

    // Interrupt handling.
    reg [4:0] icr_mask;
    reg [4:0] icr_data;

    wire ir = |(icr_data & icr_mask);
    assign IRQ_n = ir ? 1'b0 : 1'bz;

    // Update icr_mask.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            icr_mask <= 5'd0;
        else if (!CS_n && !RW && A == REG_ICR) begin
            if (D[7])
                icr_mask <= icr_mask | D[4:0];
            else
                icr_mask <= icr_mask & ~D[4:0];
        end
    end

    wire [4:0] icr_set = {flag_falling, shift_complete, alarm_fired, tb_underflowing, ta_underflowing};

    // Update icr_data.
    always @(negedge E_CLK or negedge RESET_n) begin
        if (!RESET_n)
            icr_data <= 5'd0;
        else begin
            if (!CS_n && RW && A == REG_ICR)
                icr_data <= icr_set;
            else
                icr_data <= icr_data | icr_set;
        end
    end

    // Reading.
    reg [7:0] data_out;
    wire drive_data_out = E_CLK && !CS_n && RW;

    assign D = drive_data_out ? data_out : 8'bz;

    always @(*) begin
        case (A)
            REG_PRA: data_out <= PA;
            REG_PRB: data_out <= PB;
            REG_DDRA: data_out <= ddra;
            REG_DDRB: data_out <= ddrb;
            REG_TA_LO: data_out <= ta_counter[7:0];
            REG_TA_HI: data_out <= ta_counter[15:8];
            REG_TB_LO: data_out <= tb_counter[7:0];
            REG_TB_HI: data_out <= tb_counter[15:8];
            REG_TOD_LOW: data_out <= tod_latched ? tod_latch[7:0] : tod_counter[7:0];
            REG_TOD_MID: data_out <= tod_latched ? tod_latch[15:8] : tod_counter[15:8];
            REG_TOD_HI: data_out <= tod_latched ? tod_latch[23:16] : tod_counter[23:16];
            REG_B_UNUSED: data_out <= 8'd0;
            REG_SDR: data_out <= sdr_in;
            REG_ICR: data_out <= {ir, 2'b00, icr_data};
            REG_CRA: data_out <= cra;
            REG_CRB: data_out <= crb;
        endcase
    end

endmodule