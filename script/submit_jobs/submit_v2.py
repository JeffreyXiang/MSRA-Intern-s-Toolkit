import json
import argparse

from azure.identity import DefaultAzureCredential

from azure.ai.ml import command
from azure.ai.ml import MLClient, Output
from azure.ai.ml.entities import Data
from azure.ai.ml.constants import AssetTypes, InputOutputModes

# Parsing args
parser = argparse.ArgumentParser(description="Job submission script of MSRA Intern's Toolkit")
parser.add_argument('--config', default="", help="Config JSON file")
args, _ = parser.parse_known_args()
config = json.load(open(args.config, 'r'))

# Workspace
ml_client = MLClient(
    credential=DefaultAzureCredential(),
    subscription_id=config['cluster']['workspace_subscription_id'],
    resource_group=config['cluster']['workspace_resource_group'],
    workspace_name=config['cluster']['workspace']
)

# Storage
data = Output(
    type=AssetTypes.URI_FOLDER,
    path=config['experiment']['workdir'],
    mode=InputOutputModes.MOUNT,
)


