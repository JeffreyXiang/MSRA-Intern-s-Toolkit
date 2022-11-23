import azureml.core
from azureml.core import Workspace
from azureml.core import Datastore
from azureml.core import Experiment
from azureml.core import ScriptRunConfig
from azureml.contrib.aisc.aiscrunconfig import AISuperComputerConfiguration

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

# Cluster
virtual_cluster_dict = {
    'msroctovc': {'subscription_id': 'd4404794-ab5b-48de-b7c7-ec1fefb0a04e', 'resource_group': 'gcr-singularity-octo', 'workspace_name': 'msroctows'},
    'msrpilot': {'subscription_id': '46da6261-2167-4e71-8b0d-f4a45215ce61', 'resource_group': 'gcr-singularity', 'workspace_name': 'msrpilotws'},
    'msrresrchvc': {'subscription_id': '22da88f6-1210-4de2-a5a3-da4c7c2a1213', 'resource_group': 'gcr-singularity-resrch', 'workspace_name': 'msrresrchws'},
}

ws = Workspace(**virtual_cluster_dict[config['cluster']['virtual_cluster']])

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
source_directory = os.path.join(os.path.dirname(__file__), "entry-script")
entry_script = "./entry-script.py"
armid = (
    f"/subscriptions/{ws.subscription_id}/"
    f"resourceGroups/{ws.resource_group}/"
    "providers/Microsoft.MachineLearningServices/"
    f"virtualclusters/{config['cluster']['virtual_cluster']}"
)

arguments = [
    "--workdir", str(data_ref),
    "--script", config['experiment']['script']
]
if config['environment']['setup_script'] != '':
    arguments += ["--setup", config['environment']['setup_script']]
if config['experiment']['copy_data']:
    sas = config['experiment']['sas_token']
    data_dir = config['experiment']['data_dir']
    arguments += ["--data_src",  
        sas[:sas.rfind('?')] + ('/' if data_dir[0] != '/' else '') + data_dir + sas[sas.rfind('?'):]
    ]
src = ScriptRunConfig(
    source_directory=source_directory,
    script=entry_script,
    arguments=arguments,
)

# Set instance and storage
src.run_config.data_references = {data_ref.data_reference_name: data_ref.to_config()}
src.run_config.target = "aisupercomputer"
src.run_config.aisupercomputer = AISuperComputerConfiguration()
src.run_config.aisupercomputer.instance_type = config['cluster']['instance_type']
src.run_config.aisupercomputer.sla_tier = config['cluster']['sla_tier']
src.run_config.aisupercomputer.image_version= config['environment']['docker_image']
src.run_config.node_count = 1
src.run_config.aisupercomputer.scale_policy.auto_scale_interval_in_sec = 36000
src.run_config.aisupercomputer.scale_policy.max_instance_type_count = 1
src.run_config.aisupercomputer.scale_policy.min_instance_type_count = 1
src.run_config.aisupercomputer.virtual_cluster_arm_id = armid

# Submit
experiment = Experiment(ws, name=config['experiment']['name'])
run = experiment.submit(src)
pprint.pprint(run)
