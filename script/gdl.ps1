param(
   [Parameter(HelpMessage="Creates a tunnel")]
   [switch]$Tunnel = $False,

   [Parameter(Mandatory=$True,HelpMessage="Last 4 digits of the GCRAZGDL host you wish to connect to")]
   [string]$Num,

   [Parameter(Mandatory=$True,HelpMessage="Your Alias in type DOMAIN.alias")]
   [string]$Alias
)

$ALIAS = $Alias
$KEYPATH = $HOME + "\.ssh\id_ed25519"

$EX1 = "7ccdb8ae-4daf-4f0f-8019-e80665eb00d2"
$EX2 = "46da6261-2167-4e71-8b0d-f4a45215ce61"
$EX3 = "992cb282-dd69-41bf-8fcc-cc8801d28b58"
$BAST1 = "GPU-Sandbox-VNET-bastion"
$BAST2 = "GPU-Sandbox2-VNET-bastion"
$RG1 = "GPU-SANDBOX"
$RG2 = "GPU-SANDBOX2"
$SANDBOXNUM=$Num

if (!(get-command az 2>$null)) {
   write-host "azure-cli not installed  -- https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux?pivots=apt"
   Return $False
}
if (((az extension list|ConvertFrom-Json).name|sls "ssh"|measure-object).count -lt 1) {
   write-host "az ssh extension not installed.  Please run the following to install."
   write-host "az extension add --name ssh"
   Return $False
}
if (!(Test-Path -Path $KEYPATH)) {
  Write-Host "Keypath not found $KEYPATH"
  Return $False
}

if ($Tunnel) {
   $BASTIONCOMMAND = "tunnel"
   $BASTIONPARAMS = "--resource-port 22 --port 2222"
} else {
   $BASTIONCOMMAND = "ssh"
   $BASTIONPARAMS = "--auth-type ssh-key --username $ALIAS --ssh-key $KEYPATH"
}

if ($SANDBOXNUM -like '0*'){
   az account set --subscription $EX1
   $COMMAND = "az network bastion $BASTIONCOMMAND --subscription $EX1 --name $BAST1 --resource-group $RG1 --target-resource-id /subscriptions/$EX1/resourceGroups/$RG1/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$SANDBOXNUM $BASTIONPARAMS"
   Write-Output $COMMAND
   Invoke-Expression $COMMAND
}
if ($SANDBOXNUM -ge 1000 -and $SANDBOXNUM -le 1115 -or $SANDBOXNUM -ge 1216 -and $SANDBOXNUM -lt 1999) {
   az account set --subscription $EX2
   $COMMAND = "az network bastion $BASTIONCOMMAND --subscription $EX2 --name $BAST1 --resource-group $RG1 --target-resource-id /subscriptions/$EX2/resourceGroups/$RG1/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$SANDBOXNUM $BASTIONPARAMS"
   Write-Output $COMMAND
   Invoke-Expression $COMMAND
}
if ($SANDBOXNUM -ge 1116 -and $SANDBOXNUM -le 1215) { 
   az account set --subscription $EX2
   $COMMAND = "az network bastion $BASTIONCOMMAND --subscription $EX2 --name $BAST2 --resource-group $RG2 --target-resource-id /subscriptions/$EX2/resourceGroups/$RG2/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$SANDBOXNUM $BASTIONPARAMS"
   Write-Output $COMMAND
   Invoke-Expression $COMMAND
}
if ($SANDBOXNUM -ge 2000 -and $SANDBOXNUM -le 2999) {
   az account set --subscription $EX3
   $COMMAND = "az network bastion $BASTIONCOMMAND --subscription $EX3 --name $BAST1 --resource-group $RG1 --target-resource-id /subscriptions/$EX3/resourceGroups/$RG1/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$SANDBOXNUM $BASTIONPARAMS"
   Write-Output $COMMAND
   Invoke-Expression $COMMAND
}