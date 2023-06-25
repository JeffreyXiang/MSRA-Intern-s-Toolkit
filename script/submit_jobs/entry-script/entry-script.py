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
import argparse


class ScriptBuilder:
    def __init__(self):
        self.cmds = ""

    def _append(self, cmd):
        if self.cmds != "":
            self.cmds += " ; "
        self.cmds += cmd

    def print(self, info):
        info = info.replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "\\$")
        self._append(f"echo \"[MSRA Intern's Toolkit] Job Launcher: {info}\"")

    def add(self, cmd):
        cmd = cmd.replace("\\;", ";")
        self.print(cmd)
        self._append(cmd)

    def run(self):
        os.system(self.cmds)


parser = argparse.ArgumentParser(description="Job Launcher of MSRA Intern's Toolkit")
parser.add_argument("--workdir", default="", help="The working directory.")
parser.add_argument("--sas", default="", help="The SAS token.")
parser.add_argument("--data_dir", default="", help="The data directory.")
parser.add_argument("--data_subdir", default="", help="The data subdirectorys.")
parser.add_argument("--setup", default="", help="The setup command.")
parser.add_argument("--script", default="", help="The running script.")
args, _ = parser.parse_known_args()

os.chdir(args.workdir)

script = ScriptBuilder()

# copy data
if args.sas != "" and args.data_dir != "":
    script.print("Copying data...")
    script.add(f"wget -P /tmp \"https://azcopyvnext.azureedge.net/release20221108/azcopy_linux_amd64_10.16.2.tar.gz\"")
    script.add(f"tar -zxvf /tmp/azcopy_linux_amd64_10.16.2.tar.gz -C /tmp")
    data_src = args.sas[:args.sas.rfind('?')] + ('/' if args.data_dir[0] != '/' else '') + args.data_dir + args.sas[args.sas.rfind('?'):]
    script.add(f"/tmp/azcopy_linux_amd64_10.16.2/azcopy copy --recursive \"{data_src}\" /tmp"
        + ("" if args.data_subdir == "" else f" --include-path \"{args.data_subdir}\""))
    script.print("Data copy done.")

# setup env
if args.setup != "":
    script.print("Setting up environment...")
    script.add(args.setup)
    script.print("Environment setup done.")

# start training
script.print("Start training...")
script.add(args.script)

print(script.cmds)
script.run()
