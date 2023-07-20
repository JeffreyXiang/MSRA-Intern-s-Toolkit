import os
import azureml.core
from azureml.core import Workspace
from azureml.core import Datastore
from azureml.core import Environment
from azureml.core import Experiment
from azureml.core import ScriptRunConfig
from azureml.core.compute import ComputeTarget
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

# Cluster
virtual_cluster_dict = {
    'msroctovc': {'subscription_id': 'd4404794-ab5b-48de-b7c7-ec1fefb0a04e', 'resource_group': 'gcr-singularity-octo', 'workspace_name': 'msroctows'},
    'msrresrchvc': {'subscription_id': '22da88f6-1210-4de2-a5a3-da4c7c2a1213', 'resource_group': 'gcr-singularity-resrch', 'workspace_name': 'msrresrchws'},
    'itplabrr1cl1': {'subscription_id': '46da6261-2167-4e71-8b0d-f4a45215ce61', 'resource_group': 'researchvc', 'workspace_name': 'resrchvc'},
}
is_itp = 'itp' in config['cluster']['virtual_cluster']

ws = Workspace(**virtual_cluster_dict[config['cluster']['virtual_cluster']], auth=AzureCliAuthentication())

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
    compute_target=None if not is_itp else
        ComputeTarget(workspace=ws, name=config['cluster']['virtual_cluster']),
    environment=None if not is_itp else
        Environment.get(workspace=ws, name=config['environment']['docker_image']),
    distributed_job_config=None if config['cluster']['node_count'] == 1 else
        PyTorchConfiguration(node_count=config['cluster']['node_count']),
)

# Set instance and storage
src.run_config.data_references = {data_ref.data_reference_name: data_ref.to_config()}
if not is_itp:
    from azureml.contrib.aisc.aiscrunconfig import AISuperComputerConfiguration
    src.run_config.target = "aisupercomputer"
    src.run_config.aisupercomputer = AISuperComputerConfiguration()
    src.run_config.aisupercomputer.instance_type = config['cluster']['instance_type']
    src.run_config.aisupercomputer.sla_tier = config['cluster']['sla_tier']
    src.run_config.aisupercomputer.image_version= config['environment']['docker_image']
    src.run_config.node_count = config['cluster']['node_count']
    src.run_config.aisupercomputer.scale_policy.auto_scale_interval_in_sec = 36000
    src.run_config.aisupercomputer.scale_policy.max_instance_type_count = config['cluster']['node_count']
    src.run_config.aisupercomputer.scale_policy.min_instance_type_count = config['cluster']['node_count']
    src.run_config.aisupercomputer.virtual_cluster_arm_id = (
        f"/subscriptions/{ws.subscription_id}/"
        f"resourceGroups/{ws.resource_group}/"
        "providers/Microsoft.MachineLearningServices/"
        f"virtualclusters/{config['cluster']['virtual_cluster']}"
    )
else:
    from azureml.contrib.core.k8srunconfig import K8sComputeConfiguration
    src.run_config.target = config['cluster']['virtual_cluster']
    src.run_config.cmk8scompute = K8sComputeConfiguration()
    src.run_config.cmk8scompute.configuration = {
        'enable_ssh': True,
        'gpu_count': int(config['cluster']['instance_type']),
        'preemption_allowed': False,
    }

# Submit
experiment = Experiment(ws, name=config['experiment']['name'])
run = experiment.submit(src)
pprint.pprint(run)
