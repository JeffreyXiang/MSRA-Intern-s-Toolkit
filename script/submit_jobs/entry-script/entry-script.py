# Author: Fangyun Wei
#
# This Python script works as the entry script of the AML job. Specifically,
# it will be uploaded by run.py, be executed on remote VM, set up necessary
# runtime environments, and then execute a designated user command.
#
# 2022.11
# Modified by Jianfeng Xiang
# Add data_src, setup params.

import os
import re
import json
import argparse


class ScriptBuilder:
    def __init__(self):
        self.cmds = ""

    def _append(self, cmd):
        if self.cmds != "":
            self.cmds += " ; "
        self.cmds += cmd

    def _mask_credentials(self, cmd):
        """
        Mask azure sas token and storage account key in the command.
        """
        args = cmd.split()
        for arg in args:
            # if contains sas token
            if re.match(r"https://\S+\?sv=\S+&st=\S+&se=\S+&sr=\S+&sp=\S+&sig=\S+", arg):
                cmd = cmd.replace(arg, "*" * 16)
        return cmd

    def print(self, info):
        info = self._mask_credentials(info) 
        self._append(f"echo \"[MSRA Intern's Toolkit] Job Launcher: {info}\"")

    def add(self, cmd):
        self.print(cmd)
        self._append(cmd)

    def run(self):
        os.system(self.cmds)


parser = argparse.ArgumentParser(description="Job Launcher of MSRA Intern's Toolkit")
parser.add_argument("--workdir", default="", help="The working directory.")
parser.add_argument("--config", default="", help="The config file.")
args = parser.parse_args()

with open(os.path.join(args.workdir, args.config), "r") as f:
    config = json.load(f)

os.chdir(args.workdir)

script = ScriptBuilder()

# copy data
copy_data = config['experiment']['copy_data']
sas = config['storage']['sas_token']
data_dir = config['experiment']['data_dir']
data_subdir = config['experiment']['data_subdir']
if copy_data and data_dir != "":
    script.print("Copying data...")
    script.add(f"wget -P /tmp \"https://azcopyvnext.azureedge.net/release20221108/azcopy_linux_amd64_10.16.2.tar.gz\"")
    script.add(f"tar -zxvf /tmp/azcopy_linux_amd64_10.16.2.tar.gz -C /tmp")
    data_src = sas[:sas.rfind('?')] + ('/' if data_dir[0] != '/' else '') + data_dir + sas[sas.rfind('?'):]
    script.add(f"/tmp/azcopy_linux_amd64_10.16.2/azcopy copy --recursive \"{data_src}\" /tmp"
        + ("" if data_subdir == "" else f" --include-path \"{data_subdir}\""))
    script.print("Data copy done.")

# setup env
setup = config['environment']['setup_script']
setup = [setup] if isinstance(setup, str) else setup
if not (setup[0] == "" and len(setup) == 1):
    script.print("Setting up environment...")
    for cmd in setup:
        script.add(cmd)
    script.print("Environment setup done.")

# start training
script.print("Start training...")
train = config['experiment']['script']
train = [train] if isinstance(train, str) else train
for cmd in train:
    script.add(cmd)

script.run()
