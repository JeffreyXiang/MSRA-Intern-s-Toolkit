export function uuid4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        // tslint:disable-next-line:no-bitwise
        const r = (Math.random() * 16) | 0;
        // tslint:disable-next-line:no-bitwise
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
};

export function parseJson(json: string): any {
    // Slice json string
    let start = -1;
    if (json.includes('{')) start = (start === -1 ? json.indexOf('{') : Math.min(start, json.indexOf('{')));
    if (json.includes('[')) start = (start === -1 ? json.indexOf('[') : Math.min(start, json.indexOf('[')));
    let end = -1;
    if (json.includes('}')) end = (end === -1 ? json.lastIndexOf('}') : Math.max(end, json.lastIndexOf('}')));
    if (json.includes(']')) end = (end === -1 ? json.lastIndexOf(']') : Math.max(end, json.lastIndexOf(']')));
    if (start === -1 || end === -1) {
        throw 'invalid_json_string';
    }
    json = json.slice(start, end + 1);
    try {
        return JSON.parse(json);
    }
    catch (e) {
        throw 'invalid_json_string';
    }
}
