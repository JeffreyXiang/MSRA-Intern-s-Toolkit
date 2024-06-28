import * as cp from 'child_process'
import {outputChannel} from '../../extension'
import { uuid4 } from './utils';
import * as rest from './rest';
import * as ad from './ad';

export class Role {
    id: string;
    name: string;
    scope: string;
    displayName: string;
    resourceName: string;
    resourceType: string;
    roleDefinitionId: string;
    roleEligibilityScheduleId: string;
    principalId: string;
    assignmentName?: string;
    assignmentType?: string;
    startDateTime?: Date;
    endDateTime?: Date;

    constructor(id: string, name: string, scope: string, displayName: string, resourceName:string, resourceType:string, roleDefinitionId: string, roleEligibilityScheduleId: string, principalId: string) {
        this.id = id;
        this.name = name;
        this.scope = scope;
        this.displayName = displayName;
        this.resourceName = resourceName;
        this.resourceType = resourceType;
        this.roleDefinitionId = roleDefinitionId;
        this.roleEligibilityScheduleId = roleEligibilityScheduleId;
        this.principalId = principalId;
    }
}

export async function getRoles(configDir?: string) {
    let requests = [
        {
            httpMethod: rest.RESTMethod.GET,
            relativeUrl: `/providers/Microsoft.Authorization/roleEligibilityScheduleInstances?api-version=2020-10-01&$filter=asTarget()`
        }, {
            httpMethod: rest.RESTMethod.GET,
            relativeUrl: `/providers/Microsoft.Authorization/roleAssignmentScheduleInstances?api-version=2020-10-01&$filter=asTarget()`
        }
    ];
    let responses = await rest.batchRequest(requests, configDir);
    let roles: Role[] = [];
    for (let response of responses[0].content.value) {
        let newRole = new Role(
            response.id,
            response.name,
            response.properties.scope,
            response.properties.expandedProperties.roleDefinition.displayName,
            response.properties.expandedProperties.scope.displayName,
            response.properties.expandedProperties.scope.type,
            response.properties.roleDefinitionId,
            response.properties.roleEligibilityScheduleId,
            response.properties.principalId,
        );
        let roleAssignment = responses[1].content.value.find((roleAssignment: any) => roleAssignment.properties.linkedRoleEligibilityScheduleInstanceId === response.id);
        if (roleAssignment) {
            newRole.assignmentName = roleAssignment.name;
            newRole.assignmentType = roleAssignment.properties.assignmentType;
            newRole.startDateTime = new Date(roleAssignment.properties.startDateTime);
            newRole.endDateTime = new Date(roleAssignment.properties.endDateTime);
        }
        roles.push(newRole);
    }
    return roles;
}

export async function getRoleAssignment(role: Role, configDir?: string) {
    let response = await rest.request(
        rest.RESTMethod.GET,
        `${role.scope}/providers/Microsoft.Authorization/roleAssignmentScheduleInstances?api-version=2020-10-01&$filter=asTarget()`,
        undefined,
        undefined,
        configDir
    );
    let roleAssignment = response.value.find((roleAssignment: any) => roleAssignment.properties.linkedRoleEligibilityScheduleInstanceId === role.id);
    if (!roleAssignment) {
        throw 'role_assignment_not_found';
    }
    return roleAssignment;
}

export async function activateRole(role: Role, configDir?: string) {
    let info = await Promise.all([
        ad.getSignedInUser(configDir),
        rest.request(
            rest.RESTMethod.GET,
            `${role.scope}/providers/Microsoft.Authorization/roleManagementPolicyAssignments?api-version=2020-10-01` +
            `&$filter=roleDefinitionId eq '${role.roleDefinitionId}'`,
            undefined,
            undefined,
            configDir
        )
    ]);
    let userId = info[0].id;
    let maximumDuration = info[1].value[0].properties.effectiveRules.find((rule: any) => rule.id === 'Expiration_EndUser_Assignment')?.maximumDuration;
    if (!maximumDuration) {
        throw 'maximum_duration_not_found'
    }

    return await rest.request(
        rest.RESTMethod.PUT,
        `${role.scope}/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/${uuid4()}?api-version=2020-10-01`,
        {
            properties: {
                principalId: userId,
                requestType: 'SelfActivate',
                roleDefinitionId: role.roleDefinitionId,
                linkedRoleEligibilityScheduleId: role.roleEligibilityScheduleId,
                justification: 'Activated by MSRA Intern\'s Toolkit for job submission.',
                scheduleInfo: {
                    expiration: {
                        type: 'AfterDuration',
                        duration: maximumDuration
                    }
                },
            }
        }, {
            'Content-Type': 'application/json'
        },
        configDir,
    );
}

export async function deactivateRole(role: Role, configDir?: string) {
    let info = await ad.getSignedInUser(configDir);
    let userId = info.id;

    return await rest.request(
        rest.RESTMethod.PUT,
        `${role.scope}/providers/Microsoft.Authorization/roleAssignmentScheduleRequests/${uuid4()}?api-version=2020-10-01`,
        {
            properties: {
                principalId: userId,
                requestType: 'SelfDeactivate',
                roleDefinitionId: role.roleDefinitionId,
                linkedRoleEligibilityScheduleId: role.roleEligibilityScheduleId,
                justification: 'Deactivated by MSRA Intern\'s Toolkit for job submission.',
            }
        }, {
            'Content-Type': 'application/json'
        },
        configDir,
    );
}
