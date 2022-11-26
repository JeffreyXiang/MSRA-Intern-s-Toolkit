# MSRA Intern's Toolkit

MSRA Intern's Toolkit is a VS Code extension for research interns in MSRA(Microsoft Research Asia) to simplify some of the troublesome but frequently used process including submitting jobs to clusters, opening tunnels to GCR sandboxes, etc.

This extension provide you a intuitive and interactive way to deal with these annoying process. Just get rid of those scripts that nobody can remember and embrace this convinient user interface.

## Features

![feature](image/feature.jpg)

## Requirements
* First of all, when using GCR. you must have a Linux SSH key generated and submitted to the GCR Pubkey Manager. For instructions in completing this setup, please reference [Generating a Key and Uploading it to GCR](https://dev.azure.com/msresearch/GCR/_wiki/wikis/GCR.wiki/4099/SSH-Key-Management).
* Install Azure CLI with version higher than 2.32. Latest: [Install the Azure CLI for Windows | Microsoft Learn](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-windows?tabs=azure-cli).
* * You can check your Azure CLI version with: `az version --output table`.
* Install the Azure CLI ssh extension: `az extension add --name ssh`.
* Make sure Powershell and OpenSSH is installed. Learn how to install them from [Installing PowerShell on Windows | Microsoft Learn](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows) and [Get started with OpenSSH for Windows | Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse?tabs=gui).

## Usage

First of all, as the welcome says, login to Azure with the **Click to login** button in the status bar. This will open a page in your default web browser. Follow the guidance to login. After the page returns, just wait a second before the extension get your account information. Then you can get access to the tools.

### Submit Jobs

* When running for the first time, there will be a message for you to setup conda environment. This is because the extension uses a conda env `msra-intern-s-toolkit` with required packs to submit the job. Press **Yes** and wait until finished before continue. You can also manual setup with `conda create -n msra-intern-s-toolkit python=3.8 && conda activate msra-intern-s-toolkit && pip install azureml-contrib-aisc && pip install azureml-sdk`.
* Fill the form and press **Submit**. If everything is ok, you shall get a success message with job id after a while.
* If you want to load the config of submitted jobs. Press **Load** and select it in submission history.

### GCR Tunnel
* Press **Add** button to setup a new tunnel.
* Input sandbox ID and port as guided. Note that:
* * Sandbox ID is the last 4 digits of the GCRAZGDL#### host you wish to connect to.
* * Local port of the tunnel, should be 5 digits start with 2.
* After the tunnel is successfully added, press **Open** button and wait for the tunnel to open.
* The tunnel will be opened on `127.0.0.1:yourport` (shown as the second row of tunnel info, below sandbox name). You can directly connect to it using `ssh -p yourport DOMAIN.youralias@127.0.0.1`. But I recommend using VS Code Remote-SSH for productivity. Edit your ssh config and add the following:
```
Host tunnel
    HostName 127.0.0.1
    Port yourport
    User DOMAIN.youralias
    StrictHostKeyChecking=No
    UserKnownHostsFile=\\.\NUL
```

## Troubleshooting

**Azure CLI not installed.**

* Install Azure CLI with version higher than 2.32. See [Install the Azure CLI for Windows | Microsoft Learn](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-windows?tabs=azure-cli).

**Command timeout.**

* Maybe caused by network issue. Check your VPN if you are remote.

### Submit Jobs

**Conda spawning failed.**

* Have you installed a conda environment?

**Conda environment not found.**

* This extension uses a conda env `msra-intern-s-toolkit` with required packs to submit the job. This can be addressed with any of the following two actions:
* * Click **Yes** when a message advices you to setup conda env (at start or after the error message).
* * Run the following command: `conda create -n msra-intern-s-toolkit python=3.8 && conda activate msra-intern-s-toolkit && pip install azureml-contrib-aisc && pip install azureml-sdk`.

### GCR Tunnel

**Powershell spawning failed.**

* Probably caused by the absense of powershell. This extention uses `pwsh.exe` and is tested with powershell7. See [Installing PowerShell on Windows | Microsoft Learn](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows)

**Powershell script forbidden.**

* Caused by powershell `SecurityError`.
* This means the script running is forbidden due to strict security setting.
* Run `Set-ExecutionPolicy RemoteSigned` with admin powershell and select yes to solve this.

**Keypath not found.**

* Means `.ssh\id_ed25519` file in the user dir is missing. Have you generated and submitted your ssh key? Following [Generating a Key and Uploading it to GCR](https://dev.azure.com/msresearch/GCR/_wiki/wikis/GCR.wiki/4099/SSH-Key-Management).

**SSH tunnel failed.**

* A possible reason is the bad owner or permissions on `.ssh/config` file. Make sure this file is owned by your alias account and no others are permitted to access. Inherit should be disabled. 

## Release Notes

### 1.0.0

First release.

Module:
* Azure Account
* Submit Jobs
* GCR Tunnel

## For more information

* [Install the Azure CLI for Windows | Microsoft Learn](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-windows?tabs=azure-cli)
* [Installing PowerShell on Windows | Microsoft Learn](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows)
* [Get started with OpenSSH for Windows | Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse?tabs=gui)
* [GCR Bastion - Overview](https://dev.azure.com/msresearch/GCR/_wiki/wikis/GCR.wiki/6627/GCR-Bastion)
* [SSH Key Management - Overview](https://dev.azure.com/msresearch/GCR/_wiki/wikis/GCR.wiki/4099/SSH-Key-Management)

**Enjoy!**
