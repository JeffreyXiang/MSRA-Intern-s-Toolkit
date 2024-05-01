import os
import azureml.core
from azureml.core import Workspace
from azureml.core import Datastore
from azureml.core import Experiment
from azureml.core import ScriptRunConfig
from azureml.core.runconfig import PyTorchConfiguration
from azureml.core.authentication import AzureCliAuthentication

print(f"The azureml-sdk version is {azureml.core.VERSION}")

import os
import json
import pprint
import argparse

# Parsing args
parser = argparse.ArgumentParser(description="Job submission script of MSRA Intern's Toolkit")
parser.add_argument('--config', default="", help="Config JSON file")
args, _ = parser.parse_known_args()
config = json.load(open(args.config, 'r'))

# Workspace
ws = Workspace(
    subscription_id=config['cluster']['workspace_subscription_id'],
    resource_group=config['cluster']['workspace_resource_group'],
    workspace_name=config['cluster']['workspace'],
    auth=AzureCliAuthentication()
)

# Storage
ds = Datastore.register_azure_blob_container(
    workspace=ws,
    datastore_name=config['storage']['datastore_name'],
    container_name=config['storage']['container_name'],
    account_name=config['storage']['account_name'],
    account_key=config['storage']['account_key'],
    create_if_not_exists=False
)
data_ref = ds.path(config['experiment']['workdir']).as_mount()

# Experiment
source_directory = os.path.join(os.path.dirname(__file__), "entry_script")
entry_script = "./entry_script.py"

arguments = [
    "--workdir", str(data_ref),
    "--config", f'.msra_intern_s_toolkit/userdata/temp/{os.path.basename(args.config)}',
]

src = ScriptRunConfig(
    source_directory=source_directory,
    script=entry_script,
    arguments=arguments,
    compute_target=None,
    environment=None,
    distributed_job_config=None if config['cluster']['node_count'] == 1 else
        PyTorchConfiguration(node_count=config['cluster']['node_count']),
    max_run_duration_seconds=14*24*60*60,
)

# Set instance and storage
src.run_config.data_references = {data_ref.data_reference_name: data_ref.to_config()}
from azureml.contrib.aisc.aiscrunconfig import AISuperComputerConfiguration
src.run_config.target = "aisupercomputer"
src.run_config.aisupercomputer = AISuperComputerConfiguration()
src.run_config.aisupercomputer.instance_type = config['cluster']['instance_type']
src.run_config.aisupercomputer.priority = "High"
src.run_config.aisupercomputer.sla_tier = config['cluster']['sla_tier']
src.run_config.aisupercomputer.image_version= config['environment']['docker_image']
src.run_config.node_count = config['cluster']['node_count']
src.run_config.aisupercomputer.scale_policy.auto_scale_interval_in_sec = 36000
src.run_config.aisupercomputer.scale_policy.max_instance_type_count = config['cluster']['node_count']
src.run_config.aisupercomputer.scale_policy.min_instance_type_count = config['cluster']['node_count']
src.run_config.aisupercomputer.virtual_cluster_arm_id = (
    f"/subscriptions/{config['cluster']['virtual_cluster_subscription_id']}/"
    f"resourceGroups/{config['cluster']['virtual_cluster_resource_group']}/"
    "providers/Microsoft.MachineLearningServices/"
    f"virtualclusters/{config['cluster']['virtual_cluster']}"
)

# Submit
experiment = Experiment(ws, name=config['experiment']['name'])
run = experiment.submit(src)
if config['experiment']['job_name'] != "":
    run.display_name = config['experiment']['job_name']
pprint.pprint(run)
