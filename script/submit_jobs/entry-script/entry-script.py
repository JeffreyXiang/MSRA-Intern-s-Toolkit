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

parser = argparse.ArgumentParser(description="Job Launcher of MSRA Intern's Toolkit")
parser.add_argument('--workdir', default="", help="The working directory.")
parser.add_argument('--data_src', default="", help="The source data directory on blob. azcopy src.")
parser.add_argument('--setup', default="", help="The source data directory on blob. azcopy src.")
parser.add_argument('--script', default="", help="The running script.")
args, _ = parser.parse_known_args()

os.chdir(args.workdir)

# copy data
if args.data_src != "":
    print("[MSRA Intern's Toolkit] Job Launcher: Copying data...")
    os.system("wget -P /tmp \"https://azcopyvnext.azureedge.net/release20221108/azcopy_linux_amd64_10.16.2.tar.gz\"")
    os.system("tar -zxvf /tmp/azcopy_linux_amd64_10.16.2.tar.gz -C /tmp")
    os.system(f"/tmp/azcopy_linux_amd64_10.16.2/azcopy copy --recursive \"{args.data_src}\" /tmp")
    print("[MSRA Intern's Toolkit] Job Launcher: Data copy done.")

# setup env
if args.setup != "":
    print("[MSRA Intern's Toolkit] Job Launcher: Setting up environment...")
    os.system(args.setup)
    print("[MSRA Intern's Toolkit] Job Launcher: Environment setup done.")

# start training
print("[MSRA Intern's Toolkit] Job Launcher: Start training.")
os.system(f"WORKDIR={args.workdir} && {args.script}")
