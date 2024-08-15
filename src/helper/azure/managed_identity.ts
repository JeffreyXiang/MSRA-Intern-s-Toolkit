import * as rest from './rest'
import * as account from './account'
import {parseJson} from './utils'

export class UserAssignedIdentity {
    id: string;
    name: string;
    subscriptionId: string;

    constructor(id: string, name: string, subscriptionId: string) {
        this.id = id;
        this.name = name;
        this.subscriptionId = subscriptionId;
    }

    static fromJSON(json: any) {
        return new UserAssignedIdentity(json.id, json.name, json.subscriptionId);
    }
}

export async function getUserAssignedIdentitiesForSubscription(subscriptionId: string, configDir?: string): Promise<UserAssignedIdentity[]> {
    let response = await rest.request(
        rest.RESTMethod.GET,
        `/subscriptions/${subscriptionId}/providers/Microsoft.ManagedIdentity/userAssignedIdentities?api-version=2023-01-31`,
        undefined,
        undefined,
        configDir
    );
    return parseJson(response).value.map((identity: any) => new UserAssignedIdentity(identity.id, identity.name, subscriptionId));
}

export async function getUserAssignedIdentities(configDir?: string): Promise<UserAssignedIdentity[]> {
    let subscriptions = await account.getSubscriptions(true, configDir);
    let identities: UserAssignedIdentity[] = [];
    let responses = await rest.batchRequest(subscriptions.map(subscription => {
        return {
            httpMethod: rest.RESTMethod.GET,
            relativeUrl: `/subscriptions/${subscription.id}/providers/Microsoft.ManagedIdentity/userAssignedIdentities?api-version=2023-01-31`
        };
    }, configDir))
    for (let response of responses) {
        identities = identities.concat(response.content.value.map((identity: any) => new UserAssignedIdentity(identity.id, identity.name, identity.subscriptionId)));
    }
    return identities;
}
