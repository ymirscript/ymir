import { AuthBlockNode, ProjectNode, RouteNode, RouterNode } from "../../../library/mod.ts";
import { AuthType, FrontendType, Method } from "../../../library/script/nodes.ts";
import { IFrontendGenerator } from "../generator.ts";
import * as path from "https://deno.land/std@0.182.0/path/mod.ts";
import { generateForm } from "./formgenerator.ts";
import { generateList } from "./listgenerator.ts";
import { generateDetail } from "./detailgenerator.ts";
import { generateTable } from "./tablegenerator.ts";

export class VanillaGenerator implements IFrontendGenerator {

    private _project: ProjectNode = null!;
    private _directory: string = null!;
    
    public async generate(project: ProjectNode, directory: string): Promise<void> {
        this._project = project;
        this._directory = directory;

        await this.generateDefaultStyles();
        await this.generateRestScript();

        await this.generateLogin();

        await this.generateRouter(this._project);
    }

    private createHtmlBoilerplate(body: () => string[]): string[] {
        return [
            "<!DOCTYPE html>",
            "<html>",
            "<head>",
            "    <meta charset=\"utf-8\" />",
            "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
            "    <title>Ymir App</title>",
            "    <link rel=\"stylesheet\" href=\"styles.css\" />",
            "</head>",
            "<body>",
            "    <script src=\"https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js\"></script>",
            "    <script src=\"rest.js\"></script>",
            "    <div class=\"container\">",
            ...body().map(x => `        ${x}`),
            "    </div>",
            "</body>",
            "</html>"
        ];
    }

    private async generateLogin() {
        const authBlock = this.getLoginAuthBlock();
        if (!authBlock) {
            return;
        }

        const withLogout = authBlock.options["withLogout"] as boolean ?? false;
        const loginPath = authBlock.options["loginPath"] as string ?? "/login";
        const logoutPath = authBlock.options["logoutPath"] as string ?? "/logout";
        const loginSource = authBlock.options["loginSource"] as string ?? "body";
        const usernameField = authBlock.options["usernameField"] as string ?? "username";
        const passwordField = authBlock.options["passwordField"] as string ?? "password";

        const code: string[] = [
            "<div class=\"card\">",
            "    <h1>Login</h1>",
            "    <input type=\"text\" placeholder=\"Username\" class=\"input\" />",
            "    <input type=\"password\" placeholder=\"Password\" class=\"input\" />",
            "    <button class=\"button\">Login</button>",
            "</div>",
            "<script>",
            "    const usernameInput = document.querySelector(\"input[type=text]\");",
            "    const passwordInput = document.querySelector(\"input[type=password]\");",
            "    const loginButton = document.querySelector(\"button\");",
            "    loginButton.addEventListener(\"click\", async () => {",
            "        const username = usernameInput.value;",
            "        const password = passwordInput.value;",
            "        if (!username || !password) {",
            "            alert(\"Please enter a username and password.\");",
            "            return;",
            "        }",
            "        ",
            "        try {",
        ];

        if (loginSource === "body") {
            code.push(
                `            const response = await restClient.post(\"${loginPath}\", {`,
                `                ${usernameField}: username,`,
                `                ${passwordField}: password,`,
                "            });",
            );
        } else if (loginSource === "query") {
            code.push(
                `            const response = await restClient.post(\"${loginPath}\", null, {`,
                "                params: {",
                `                    ${usernameField}: username,`,
                `                    ${passwordField}: password,`,
                "                },",
                "            });",
            );
        } else if (loginSource === "header") {
            code.push(
                `            const response = await restClient.post(\"${loginPath}\", null, {`,
                "                headers: {",
                `                    ${usernameField}: username,`,
                `                    ${passwordField}: password,`,
                "                },",
                "            });",
            );
        }

        code.push(
            "            localStorage.setItem(\"login_token\", response.data.token);",
            "            window.location.href = \"/login-success.html\";",
            "        } catch (e) {",
            "            alert(\"Invalid username or password.\");",
            "            console.error(e);",
            "        }",
            "    });",
            "</script>",
        );


        await this.createFile("login.html", this.createHtmlBoilerplate(() => code));

        const successCode: string[] = [
            "<div class=\"card\">",
            "    <h1>Login Success</h1>",
            "    <p>You have successfully logged in.</p>",
            "</div>",
            "<script>",
            "    setTimeout(() => {",
            "        window.location.href = \"/index.html\";",
            "    }, 5000);",
            "</script>",
        ];

        await this.createFileOnce("login-success.html", this.createHtmlBoilerplate(() => successCode));

        if (withLogout) {
            const logoutCode: string[] = [
                "<div class=\"card\">",
                "    <h1>Logout</h1>",
                "    <p>Are you sure you want to logout?</p>",
                "    <button class=\"button\">Logout</button>",
                "</div>",
                "<script>",
                "    const logoutButton = document.querySelector(\"button\");",
                "    logoutButton.addEventListener(\"click\", async () => {",
                "        try {",
                `            await restClient.post(\"${logoutPath}\");`,
                "            localStorage.removeItem(\"login_token\");",
                "            window.location.href = \"/logout-success.html\";",
                "        } catch (e) {",
                "            alert(\"An error occurred while logging out.\");",
                "            console.error(e);",
                "        }",
                "    });",
                "</script>",
            ];

            await this.createFileOnce("logout.html", this.createHtmlBoilerplate(() => logoutCode));

            const logoutSuccessCode: string[] = [
                "<div class=\"card\">",
                "    <h1>Logout Success</h1>",
                "    <p>You have successfully logged out.</p>",
                "</div>",
                "<script>",
                "    setTimeout(() => {",
                "        window.location.href = \"/index.html\";",
                "    }, 5000);",
                "</script>",
            ];

            await this.createFileOnce("logout-success.html", this.createHtmlBoilerplate(() => logoutSuccessCode));
        }
    }

    private async generateRouter(router: RouterNode, currentParentPath?: string) {
        const parentPath = currentParentPath ? this.combinePaths([currentParentPath, router.path.path]) : router.path.path;

        await Promise.all(router.routes.map(route => {
            return this.generateRoute(parentPath, route);
        }));

        await Promise.all(router.routers.map(router => {
            return this.generateRouter(router, parentPath);
        }));
    }

    private async generateRoute(parentPath: string, route: RouteNode) {
        if (!route.rendering) {
            return;
        }

        const code: string[] = [
            `<div class="card">`,
            `    <h1>${route.path.alias ?? route.path.path}</h1>`,
        ];

        if (route.method === Method.Post || route.method === Method.Patch) {
            code.push(...generateForm(parentPath, route).map((x: string) => `    ${x}`));
        } else if (route.method === Method.Get) {
            let integrates: string[] = [];
            if (route.rendering.options && route.rendering.options["integrate"] && Array.isArray(route.rendering.options["integrate"]) && route.rendering.options["integrate"].every(x => typeof x === "string")) {
                integrates = route.rendering.options["integrate"] as string[];
            }

            switch (route.rendering.type) {
                case FrontendType.List:
                    code.push(...generateList(parentPath, route, integrates, this._project, this).map((x: string) => `    ${x}`));
                    break;
                case FrontendType.Detail:
                    code.push(...generateDetail(parentPath, route, integrates, this._project, this).map((x: string) => `    ${x}`));
                    break;
                case FrontendType.Table:
                    code.push(...generateTable(parentPath, route, integrates, this._project, this).map((x: string) => `    ${x}`));
                    break;
            }
        }

        code.push("</div>");

        await this.createFile(this.getRouteFileName(parentPath, route), this.createHtmlBoilerplate(() => code));
    } 

    private async generateRestScript() {
        const code: string[] = [
            "const API_URL = \"http://localhost:3000\";",
            "",
            "const restClient = axios.create({",
            "    baseURL: API_URL,",
            "    timeout: 1000,",
            "    headers: {",
            "        \"Content-Type\": \"application/json\",",
            "    },",
            "});",
            "",
            "restClient.interceptors.request.use(config => {",
            "    const token = localStorage.getItem(\"login_token\");",
            "    if (token) {",
            "        config.headers[\"Authorization\"] = `Bearer ${token}`;",
            "    }",
            "    return config;",
            "});",
        ];

        await this.createFileOnce("rest.js", code);
    }

    private async generateDefaultStyles() {
        const code: string[] = [
            "html, body {",
            "    margin: 0;",
            "    padding: 0;",
            "    font-family: sans-serif;",
            "}",
            "",
            "body {",
            "    background-color: #62d1bd;",
            "    color: #333;",
            "}",
            "",
            ".container {",
            "    width: 100%;",
            "    min-height: 100vh;",
            "    display: flex;",
            "    flex-direction: column;",
            "    align-items: center;",
            "    justify-content: center;",
            "}",
            "",
            ".card {",
            "    background-color: #fff;",
            "    border-radius: 5px;",
            "    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);",
            "    padding: 20px;",
            "    min-width: 400px;",
            "    max-width: 100%;",
            "}",
            "",
            ".card > * {",
            "    margin: 10px 0;",
            "}",
            "",
            ".card > h1 {",
            "    font-size: 1.5em;",
            "    margin: 0;",
            "}",
            "",
            ".input {",
            "    width: 100%;",
            "    padding: 10px;",
            "    border: 1px solid #ccc;",
            "    border-radius: 5px;",
            "    box-sizing: border-box;",
            "}",
            "",
            ".button {",
            "    width: 100%;",
            "    padding: 10px;",
            "    border: 0;",
            "    border-radius: 5px;",
            "    background-color: #62d1bd;",
            "    color: #fff;",
            "    font-weight: bold;",
            "    cursor: pointer;",
            "}",
            "",
            ".button:hover {",
            "    background-color: #4db2a0;",
            "}",
            "",
            ".button:active {",
            "    background-color: #3d8c7a;",
            "}",
            "",
            ".button.danger {",
            "    background-color: #e74c3c;",
            "}",
            "",
            ".button.danger:hover {",
            "    background-color: #c0392b;",
            "}",
            "",
            ".button.danger:active {",
            "    background-color: #a5281a;",
            "}",
            "",
            ".button.success {",
            "    background-color: #2ecc71;",
            "}",
            "",
            ".button.success:hover {",
            "    background-color: #27ae60;",
            "}",
            "",
            ".button.success:active {",
            "    background-color: #1d834e;",
            "}",
            "",
            "form {",
            "    display: flex;",
            "    flex-direction: column;",
            "    align-items: center;",
            "    gap: 1rem;",
            "}",
            "",
            ".form-control {",
            "    display: flex;",
            "    flex-direction: column;",
            "    width: 100%;",
            "}",
            "",
            ".form-control > label {",
            "    font-weight: bold;",
            "}",
            "",
            ".form-control > input {",
            "    margin-top: 5px;",
            "}",
            "",
            ".form-control > select {",
            "    margin-top: 5px;",
            "}",
            "",
            ".form-control > textarea {",
            "    margin-top: 5px;",
            "}",
            "",
            ".form-control > button {",
            "    margin-top: 5px;",
            "}",
            "",
            ".form-control > .error {",
            "    color: #e74c3c;",
            "    font-size: 0.8em;",
            "}",
            "",
            ".form-control > .error::before {",
            "    content: \"⚠ \";",
            "}",
            "",
            ".form-control > .error::after {",
            "    content: \"\";",
            "    display: block;",
            "    height: 5px;",
            "}",
            "",
            ".form-group {",
            "    padding: 10px;",
            "    border: 1px solid #ccc;",
            "    border-radius: 5px;",
            "    margin-bottom: 10px;",
            "    display: flex;",
            "    flex-direction: column;",
            "}",
            ".form-group > * {",
            "    margin: 5px 0;",
            "}",
            ".button-group {",
            "    display: flex;",
            "    flex-direction: row;",
            "    justify-content: flex-end;",
            "}",
            ".button-group > * {",
            "    margin: 0 5px;",
            "}",
            "",
            ".table {",
            "    width: 100%;",
            "    border-collapse: collapse;",
            "}",
            "",
            ".table > thead > tr > th,",
            ".table > tbody > tr > td {",
            "    border: 1px solid #ccc;",
            "    padding: 5px;",
            "}",
            "",
            ".table > thead > tr > th {",
            "    font-weight: bold;",
            "}",
            "",
            ".table > tbody > tr > td {",
            "    text-align: center;",
            "}",
            "",
            ".table > tbody > tr:nth-child(odd) {",
            "    background-color: #eee;",
            "}",
            "",
            ".table > tbody > tr:hover {",
            "    background-color: #ddd;",
            "}",
            "",
            ".table > tbody > tr > td > button:not(.button) {",
            "    margin: 0;",
            "    margin-left: 5px;",
            "    padding: 0;",
            "    border: 0;",
            "    background-color: transparent;",
            "    color: #62d1bd;",
            "    font-weight: bold;",
            "    cursor: pointer;",
            "}",
            "",
            ".table > tbody > tr > td > button:not(.button):hover {",
            "    text-decoration: underline;",
            "}",
            "",
            ".table > tbody > tr > td > button:not(.button):active {",
            "    color: #4db2a0;",
            "}",
            "",
            ".list {",
            "    width: 100%;",
            "    list-style: none;",
            "    padding: 0;",
            "}",
            "",
            ".list > li {",
            "    padding: 10px;",
            "    border: 1px solid #ccc;",
            "    border-radius: 5px;",
            "    margin-bottom: 10px;",
            "}",
            "",
            ".list > li > * {",
            "    margin: 5px 0;",
            "}",
            "",
            ".list > li > button:not(.button) {",
            "    margin: 0;",
            "    margin-left: 5px;",
            "    padding: 0;",
            "    border: 0;",
            "    background-color: transparent;",
            "    color: #62d1bd;",
            "    font-weight: bold;",
            "    cursor: pointer;",
            "}",
            "",
            ".list > li > button:not(.button):hover {",
            "    text-decoration: underline;",
            "}",
            "",
            ".list > li > button:not(.button):active {",
            "    color: #4db2a0;",
            "}",
            "",
            ".list > li > span {",
            "    font-weight: bold;",
            "}",
        ];

        await this.createFileOnce("styles.css", code);
    }

    private async createFileOnce(name: string, content: string[]) {
        const filePath = path.join(this._directory, name);
        if (!await Deno.stat(filePath).then(x => x.isFile).catch(() => false)) {
            await Deno.writeTextFile(filePath, content.join("\n"));
        }
    }

    private async createFile(name: string, content: string[]) {
        const filePath = path.join(this._directory, name);

        const directories = path.dirname(filePath).split(path.SEP);
        for (let i = 0; i < directories.length; i++) {
            const directory = directories.slice(0, i + 1).join(path.SEP);
            if (!await Deno.stat(directory).then(x => x.isDirectory).catch(() => false)) {
                await Deno.mkdir(directory);
            }
        }

        await Deno.writeTextFile(filePath, content.join("\n"));
    }

    private getLoginAuthBlock(): AuthBlockNode|undefined {
        return Object.values(this._project.authBlocks).find(x => x.type === AuthType.Bearer && x.options["mode"] === "FULL");
    }

    public getRouteFileName(parentPath: string, route: RouteNode): string {
        return this.translateUrlToPath(this.combinePaths([parentPath, route.method.toLocaleLowerCase() + "_" + route.path.path.substring(1)])) + ".html";
    }

    private combinePaths(paths: string[]): string {
        return paths.join("/").replace(/\/+/g, "/");
    }

    private translateUrlToPath(url: string): string {
        return url.split('/').join('_').replace(/[^a-zA-Z0-9_]/g, "").substring(1);
    }
}