#!/usr/bin/env python
# -*- encoding: utf-8 -*-

import os

# Get the directory where this script is located
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def run_command(cmd):
    print(f"--- Executing: {cmd} ---")
    os.system(cmd)

# 1. IHP SG13G2 (130nm)
run_command(f'git clone https://github.com/IHP-GmbH/IHP-Open-PDK.git {SCRIPT_DIR}/IHP-Open-PDK')
run_command(f'cd {SCRIPT_DIR}/IHP-Open-PDK && git checkout 68eebafcd9b2f5e92c69d37a8d3d90eb266550f5 && git submodule init')

# 2. ICSPROUT 55nm
run_command(f'git clone --recursive --depth 1 https://github.com/openecos-projects/icsprout55-pdk.git {SCRIPT_DIR}/icsprout55-pdk')

# 3. SkyWater 130nm (SKY130)
# We use depth 1 to save space as the full history is very large
run_command(f'git clone --recursive --depth 1 https://github.com/google/skywater-pdk.git {SCRIPT_DIR}/sky130-pdk')

# 4. GlobalFoundries 180nm (GF180MCU)
run_command(f'git clone --recursive --depth 1 https://github.com/google/gf180mcu-pdk.git {SCRIPT_DIR}/gf180mcu-pdk')

print("\nAll PDKs have been downloaded to:")
print(f"{SCRIPT_DIR}")