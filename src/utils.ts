import * as vscode from 'vscode';

export function showErrorMessageWithHelp(text: string){
    vscode.window.showErrorMessage(text, 'Helps' ,'OK').then((choice) => {
        if (choice == 'Helps'){
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/JeffreyXiang/MSRA-Intern-s-Toolkit#troubleshooting'))
        }
    })
}
