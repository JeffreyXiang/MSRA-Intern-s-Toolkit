import * as vscode from 'vscode';

export function deepCopy(obj: any): any {
    var copy;

    // Handle the 3 simple types, and null or undefined
    if (null == obj || typeof obj != "object") return obj;

    // Handle Array
    if (obj instanceof Array) {
        copy = [];
        for (var i = 0, len = obj.length; i < len; i++) {
            copy[i] = deepCopy(obj[i]);
        }
        return copy;
    }

    // Handle Object
    if (obj instanceof Object) {
        copy = {} as any; // Add an index signature to allow indexing with a string
        for (var attr in obj) {
            if (obj.hasOwnProperty(attr)) copy[attr] = deepCopy(obj[attr]);
        }
        return copy;
    }

    throw new Error("Unable to copy obj! Its type isn't supported.");
}

export function showErrorMessageWithHelp(text: string){
    vscode.window.showErrorMessage(text, 'Helps' ,'OK').then((choice) => {
        if (choice == 'Helps'){
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/JeffreyXiang/MSRA-Intern-s-Toolkit#troubleshooting'))
        }
    })
}
