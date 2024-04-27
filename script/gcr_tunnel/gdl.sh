while getopts tn:a:p: args; do
    case $args in
        t) tunnel=true ;;
        n) number=${OPTARG} ;;
        a) alias=${OPTARG} ;;
        p) port=${OPTARG} ;;
    esac
done

ALIAS=$alias
KEYPATH=~/.ssh/id_ed25519

EX1=7ccdb8ae-4daf-4f0f-8019-e80665eb00d2
EX2=46da6261-2167-4e71-8b0d-f4a45215ce61
EX3=992cb282-dd69-41bf-8fcc-cc8801d28b58
BAST1=GPU-Sandbox-VNET-bastion
BAST2=GPU-Sandbox2-VNET-bastion
BAST3=GPU-Sandbox3-VNET-bastion
RG1=GPU-SANDBOX
RG2=GPU-SANDBOX2
RG3=GPU-SANDBOX3

if [ ! $(which az) ]; then
   echo "azure-cli not installed  -- https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux?pivots=apt"
   exit 2
fi
if [ "$(az extension list | grep ssh | awk '/cliextensions/ssh {print }'|wc -l)" -lt 1 ]; then
   echo "az ssh extension not installed.  Please run the following to install:"
   echo "az extension add --name ssh"
   exit 3
fi
if [ ! -f "$KEYPATH" ]; then
   echo "Keypath not found $KEYPATH"
   exit 4
fi

if [[ "$tunnel" == true ]];then
   BASTIONCOMMAND="tunnel"
   BASTIONPARAMS="--resource-port 22 --port $port"
else
   BASTIONCOMMAND="ssh"
   BASTIONPARAMS="--auth-type ssh-key --username $ALIAS --ssh-key $KEYPATH"
fi

if [[ "$number" == 0* ]]; then
   az account set --subscription $EX1
   COMMAND="az network bastion $BASTIONCOMMAND --subscription $EX1 --name $BAST1 --resource-group $RG1 --target-resource-id /subscriptions/$EX1/resourceGroups/$RG1/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$number $BASTIONPARAMS"
   echo $COMMAND
   $COMMAND
fi
if [[ "$number" -ge "1000" ]] && [[ "$number" -le "1115" ]]; then
   az account set --subscription $EX2
   COMMAND="az network bastion $BASTIONCOMMAND --subscription $EX2 --name $BAST1 --resource-group $RG1 --target-resource-id /subscriptions/$EX2/resourceGroups/$RG1/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$number $BASTIONPARAMS"
   echo $COMMAND
   $COMMAND
fi
if [[ "$number" -ge "1116" ]] && [[ "$number" -le "1215" ]]; then
   az account set --subscription $EX2
   COMMAND="az network bastion $BASTIONCOMMAND --subscription $EX2 --name $BAST2 --resource-group $RG2 --target-resource-id /subscriptions/$EX2/resourceGroups/$RG2/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$number $BASTIONPARAMS"
   echo $COMMAND
   $COMMAND
fi
if [[ "$number" -ge "1400" ]] && [[ "$number" -le "1767" ]]; then
   az account set --subscription $EX2
   COMMAND="az network bastion $BASTIONCOMMAND --subscription $EX2 --name $BAST3 --resource-group $RG3 --target-resource-id /subscriptions/$EX2/resourceGroups/$RG3/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$number $BASTIONPARAMS"
   echo $COMMAND
   $COMMAND
fi
if [[ "$number" -ge "3001" ]] && [[ "$number" -le "3068" ]]; then
   az account set --subscription $EX2
   COMMAND="az network bastion $BASTIONCOMMAND --subscription $EX2 --name $BAST3 --resource-group $RG3 --target-resource-id /subscriptions/$EX2/resourceGroups/$RG3/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$number $BASTIONPARAMS"
   echo $COMMAND
   $COMMAND
fi
if [[ "$number" -ge "4001" ]] && [[ "$number" -le "4020" ]]; then
   az account set --subscription $EX2
   COMMAND="az network bastion $BASTIONCOMMAND --subscription $EX2 --name $BAST3 --resource-group $RG3 --target-resource-id /subscriptions/$EX2/resourceGroups/$RG3/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$number $BASTIONPARAMS"
   echo $COMMAND
   $COMMAND
fi
if [[ "$number" -ge "2000" ]] && [[ "$number" -le "2999" ]]; then
   az account set --subscription $EX3
   COMMAND="az network bastion $BASTIONCOMMAND --subscription $EX3 --name $BAST1 --resource-group $RG1 --target-resource-id /subscriptions/$EX3/resourceGroups/$RG1/providers/Microsoft.Compute/virtualMachines/GCRAZGDL$number $BASTIONPARAMS"
   echo $COMMAND
   $COMMAND
fi

echo "Done with code $?"
exit $?
