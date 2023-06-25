# ---------------------------------------------------------
# Copyright (c) Microsoft Corporation. All rights reserved.
# ---------------------------------------------------------
"""Contains functionality for managing the configuration of experiment runs
in Azure Machine Learning.

The key class in this module is :class:`azureml.contrib.core.k8srunconfig.K8sComputeConfiguration`,
which encapsulates information necessary to submit a training run on k8s compute target."""
import collections

from azureml._base_sdk_common.field_info import _FieldInfo
from azureml._base_sdk_common.abstract_run_config_element import _AbstractRunConfigElement


class K8sComputeConfiguration(_AbstractRunConfigElement):
    """Represents configuration information for experiments that target AksCompute.

    This class is used in the :class:`azureml.core.runconfig.RunConfiguration` class.

    :param configuration: The configuration only takes effect when the compute target is k8s.
    :type configuration: dict
    """

    # This is used to deserialize.
    # This is also the order for serialization into a file.
    _field_to_info_dict = collections.OrderedDict([
        ("configuration", _FieldInfo(dict, "k8s configuration specific details, "
                                           "the keys that was supported now are: "
                                           "enable_ssh, enable_ipython,"
                                           "enable_tensorboard, interactive_port, "
                                           "enable_preemption, job_priority")),
    ])

    def __init__(self):
        """
        The keys that was supported now are: enable_ssh(bool), enable_ipython(bool),
        enable_tensorboard(bool), interactive_port(int), enable_preemption(bool), job_priority(int).
        """
        self.configuration = {"preemption_allowed": True}
