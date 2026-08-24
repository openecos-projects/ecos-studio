# Auto-generated SDC file

set clk_name E_CLK 
set clk_port_name E_CLK
set clk_freq_mhz 100
set clk_period [expr 1000.0 / $clk_freq_mhz]
set clk_io_pct 0.2
set clk_port [get_ports $clk_port_name]
create_clock -name $clk_name -period $clk_period $clk_port
