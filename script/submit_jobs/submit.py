import os
import json
import argparse
from azure.identity import AzureCliCredential
from azure.ai.ml import MLClient, Output, command
from azure.ai.ml.constants import AssetTypes, InputOutputModes
from azure.ai.ml.entities import AzureBlobDatastore, AccountKeyConfiguration, Environment

# Parsing args
parser = argparse.ArgumentParser(description="Job submission script of MSRA Intern's Toolkit")
parser.add_argument('--config', default="", help="Config JSON file")
args, _ = parser.parse_known_args()
config = json.load(open(args.config, 'r'))

# Workspace
ml_client = MLClient(
    credential=AzureCliCredential(),
    subscription_id=config['cluster']['workspace_subscription_id'],
    resource_group_name=config['cluster']['workspace_resource_group'],
    workspace_name=config['cluster']['workspace']
)

# Storage
data = AzureBlobDatastore(
    name=config['storage']['datastore_name'],
    account_name=config['storage']['account_name'],
    container_name=config['storage']['container_name'],
    protocol="https",
    credentials=AccountKeyConfiguration(
        account_key=config['storage']['account_key']
    ),
)
ml_client.create_or_update(data)

storage = Output(
    type=AssetTypes.URI_FOLDER,
    path=f"azureml://datastores/{config['storage']['datastore_name']}/paths/{config['experiment']['workdir']}",
    mode=InputOutputModes.RW_MOUNT
)

# Job
job = command(
    display_name=config['experiment']['job_name'],
    code=os.path.join(os.path.dirname(__file__), "entry_script"),
    command=f"python entry_script.py --workdir ${{{{outputs.storage}}}} --config .msra_intern_s_toolkit/userdata/temp/{os.path.basename(args.config)}",
    outputs={'storage': storage},
    environment=Environment(image="mcr.microsoft.com/azureml/openmpi3.1.2-ubuntu18.04:20210513.v1"),
    compute=(
        f"/subscriptions/{config['cluster']['virtual_cluster_subscription_id']}/"
        f"resourceGroups/{config['cluster']['virtual_cluster_resource_group']}/"
        "providers/Microsoft.MachineLearningServices/"
        f"virtualclusters/{config['cluster']['virtual_cluster']}"
    ),
    distribution={
        "type": "PyTorch",
        "process_count_per_instance": 1,
    },
    resources={
        "instance_type": f"Singularity.{config['cluster']['instance_type']}",
        "instance_count": config['cluster']['node_count'],
        "properties" : {
            "AISuperComputer" : {
                "interactive" : True,
                "imageVersion": config['environment']['docker_image'],
                "priority": "High",
                "slaTier": config['cluster']['sla_tier'],
                "scalePolicy": {
                    "autoScaleIntervalInSec": 120,
                    "maxInstanceTypeCount": config['cluster']['node_count'],
                    "minInstanceTypeCount": config['cluster']['node_count'],
                },
            }
        }
    }
)

# Submit
returned_job = ml_client.jobs.create_or_update(job, experiment_name=config['experiment']['name'])
print(f"Job Submitted: {json.dumps({'displayName': returned_job.display_name, 'studioUrl': returned_job.studio_url})}")
