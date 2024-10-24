import * as cp from 'child_process'
import axios from 'axios'
import { getAccessToken } from './account'
import { outputChannel } from '../../extension'
import { uuid4 } from './utils'
import { promises } from 'fs'

export enum RESTMethod {
    DELETE = 'delete',
    GET = 'get',
    HEAD = 'head',
    OPTIONS = 'options',
    PATCH = 'patch',
    POST = 'post',
    PUT = 'put',
}

export async function request(method: RESTMethod, uri: string, body?: any, headers?: {[key: string]: string}, configDir?: string) {
    if (!headers) headers = {};
    if (!headers.hasOwnProperty('Authorization')) {
        headers['Authorization'] = `Bearer ${await getAccessToken(configDir)}`;
    }
    if (!headers.hasOwnProperty('Content-Type')) {
        headers['Content-Type'] = 'application/json';
    }
    // Add a unique identifier to the request
    if (!headers.hasOwnProperty('x-ms-client-request-id')) {
        headers['x-ms-client-request-id'] = uuid4();
    }
    outputChannel.appendLine(`[REST] > ${method.toUpperCase()} ${uri} ${JSON.stringify(body)} ${JSON.stringify(headers)}`);
    try {
        let response = await axios.request({
            method: method,
            url: uri,
            baseURL: uri.startsWith('http') ? undefined : 'https://management.azure.com',
            data: body,
            headers: headers,
        });
        outputChannel.appendLine(`[REST OUT] ${JSON.stringify(response.data)}`);
        return response.data;
    } catch (error: any) {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            outputChannel.appendLine(`[REST ERR] ${error.response.status} ${JSON.stringify(error.response.data)}`);
            throw error.response.data;
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
            outputChannel.appendLine(`[REST ERR] No response received`);
            throw 'no_response_received'
        } else {
            // Something happened in setting up the request that triggered an Error
            outputChannel.appendLine(`[REST ERR] Bad request ${error.message}`);
            throw error.message;
        }        
    }
}

export async function batchRequest(requests: {httpMethod: RESTMethod, relativeUrl: string, content?: any}[], configDir?: string) {
    if (requests.length > 20) { // Azure batch request limit, divide into multiple requests
        let requestsParts = [];
        while (requests.length) {
            requestsParts.push(requests.splice(0, 20));
        }
        let responsesParts = await Promise.all(requestsParts.map(async (requestsPart) => {
            return await batchRequest(requestsPart, configDir);
        }));
        let responses: any[] = [];
        for (let responsesPart of responsesParts) {
            responses = responses.concat(responsesPart);
        }
        return responses;
    }
    else {
        let responses = await request(
            RESTMethod.POST,
            '/batch?api-version=2020-06-01',
            {requests: requests},
            undefined,
            configDir,
        );
        return responses.responses;
    }
}
