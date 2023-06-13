import { AbortError, FrontendType, Logger, Method, MiddlewareOptions, ProjectNode, RouteNode } from "../../../library/mod.ts";

/**
 * Generates a form for the given route.
 * 
 * @param parentPath The path of the parent route.
 * @param route The route to generate the form for.
 */
export function generateForm(parentPath: string, route: RouteNode, proj: ProjectNode): string[] {
    if (!route.body || !route.rendering || route.rendering.type !== FrontendType.Form) {
        Logger.fatal(`The route ${route.path.alias ?? route.path.path} does not have a body.`);

        throw new AbortError();
    }

    if (route.method !== "POST" && route.method !== "PATCH") {
        Logger.fatal(`The route ${route.path.alias ?? route.path.path} does not support forms.`);

        throw new AbortError();
    }

    const getterAlias = (route.rendering.options ? route.rendering.options.getter : undefined) as (string | undefined); 
    const getterCode: string[] = [];
    if (route.method === "PATCH") {
        if (!getterAlias) {
            Logger.warning(`The route ${route.path.alias ?? route.path.path} does not have a getter alias.`);
        } else {
            const getter = proj.findRouteByAlias(getterAlias);
            if (!getter) {
                Logger.error(`Could not find getter ${getterAlias}.`);
    
                throw new AbortError();
            }
    
            const [getterRoute, getterParentPath] = getter;
    
            getterCode.push(...[
                `restClient.get((\`${getterParentPath}${getterParentPath.endsWith("/") ? '' : '/'}${(getterRoute.path.path.startsWith("/") ? getterRoute.path.path.substring(1) : getterRoute.path.path)}\`).replace(":id", id)).then((response) => {`,
                `    if (response.data) {`,
                `        const body = response.data;`,
                `        const flatten = (obj, prefix = '') =>`,
                `            Object.keys(obj).reduce((acc, k) => {`,
                `                const pre = prefix.length ? prefix + '.' : '';`,
                `                if (typeof obj[k] === 'object') Object.assign(acc, flatten(obj[k], pre + k));`,
                `                else acc[pre + k] = obj[k];`,
                `                return acc;`,
                `            }, {});`,
                `        const flattened = flatten(body);`,
                `        for (const key in flattened) {`,
                `            const value = flattened[key];`,
                `            const element = document.getElementById(INPUT_MAPPING[key]);`,
                `            if (element === null) {`,
                `                continue;`,
                `            }`,
                `            if (element.type === "checkbox") {`,
                `                element.checked = value;`,
                `            } else {`,
                `                element.value = value;`,
                `            }`,
                `        }`,
                `    }`,
                `}).catch((error) => {`,
                `    console.error(error);`,
                `});`
            ]);
        }
    }

    const axiosMethod = route.method === "POST" ? "post" : "patch";
    let axiosUrl = `${parentPath}${parentPath.endsWith("/") ? '' : '/'}${(route.path.path.startsWith("/") ? route.path.path.substring(1) : route.path.path)}`;

    if (axiosUrl.includes(":id")) {
        axiosUrl = axiosUrl.replace(":id", "${id}");
    }

    const html: string[] = [];
    const script: string[] = [];
    const inputMappingScript: string[] = [];

    parseObject(html, script, route.body, false, 0, "body", "", inputMappingScript);
    
    return [
        "<form onsubmit=\"return false;\">",
        ...html.map((line) => `    ${line}`),
        "    <button class=\"button\" onclick=\"send()\">Submit</button>",
        "</form>",
        "<script>",
        ...[
            `const INPUT_MAPPING = {};`,
            ...(route.method !== Method.Patch ? [] : [
                `const id = new URLSearchParams(window.location.search).get("id");`,
                `if (id === null) {`,
                `    alert("The id is required.");`,
                `    window.location.href = "/";`,
                `}`,
                ...getterCode,
                ""
            ]),
            "function parseInputValue(id, type) {",
            "    const element = document.getElementById(id);",
            "    if (element === null) {",
            "        return undefined;",
            "    }",
            "",
            "    if (type === \"boolean\") {",
            "        return element.checked;",
            "    }",
            "",
            "    if (type === \"int\") {",
            "        return parseInt(element.value === '' ? '0' : element.value);",
            "    }",
            "",
            "    if (type === \"float\") {",
            "        return parseFloat(element.value === '' ? '0' : element.value);",
            "    }",
            "",
            "    if (type === \"date\" || type === \"datetime\" || type === \"time\") {",
            "        return isNaN(Date.parse(element.value)) ? undefined : new Date(element.value);",
            "    }",
            "",
            "    return element.value;",
            "}",
            "",
            "function getBody() {",
            "    const body = {};",
            ...script,
            "    return body;",
            "}",
            "",
            "function send() {",
            "    const body = getBody();",
            "    if (body === undefined) {",
            "        return;",
            "    }",
            "",
            `    restClient.${axiosMethod}(\`${axiosUrl}\`, body).then((response) => {`,
            "        alert(\"The request was successful.\");",
            "        window.location.reload();",
            "    }).catch((error) => {",
            "        console.error(error);",
            "    });",
            "}",
            "",
            ...inputMappingScript,
        ].map((line) => `    ${line}`),
        "</script>"
    ]
}

function parseObject(html: string[], script: string[], object: MiddlewareOptions, useGroup: boolean, indentNr: number, fieldPath: string, mappingKey: string, inputMappingScript: string[]) {
    // deno-lint-ignore no-inferrable-types
    const i = (offset: number = 0) => "    ".repeat(indentNr + offset);

    if (useGroup) {
        html.push(`${i()}<div class="form-group">`);
    }

    for (const key in object) {
        const value = object[key];
        
        html.push(...[
            `${i(!useGroup ? 0 : 1)}<div class="form-control">`,
            `${i(!useGroup ? 1 : 2)}<label>${key}</label>`
        ]);

        const innerHtml: string[] = [];
        const innerScript: string[] = [];

        if (typeof value === "object") {
            script.push(`    ${fieldPath}["${key}"] = {};`);

            parseObject(innerHtml, innerScript, value as MiddlewareOptions, true, useGroup ? 1 : 0, `${fieldPath}["${key}"]`, mappingKey.length === 0 ? key : `${mappingKey}.${key}`, inputMappingScript);
        } else if (typeof value === "string") {
            parseSimpleInput(innerHtml, innerScript, key, value, `${fieldPath}["${key}"]`, mappingKey.length === 0 ? key : `${mappingKey}.${key}`, inputMappingScript);
        } else {
            Logger.error(`The value of the key ${key} is not supported.`);

            throw new AbortError();
        }

        html.push(...innerHtml.map((line) => `${i(!useGroup ? 1 : 2)}${line}`));
        script.push(...innerScript.map((line) => `${i(!useGroup ? 1 : 0)}${line}`));

        html.push(`${i(!useGroup ? 0 : 1)}</div>`);
    }

    if (useGroup) {
        html.push(`${i()}</div>`);
    }
}

function parseSimpleInput(html: string[], script: string[], key: string, type: string, field: string, mappingKey: string, inputMappingScript: string[]) {
    const id = randomElementId();

    const attrs: string[] = [];

    if (type === "boolean") {
        attrs.push("type=\"checkbox\"");
    } else if (type === "int" || type === "float") {
        attrs.push("type=\"number\"");

        if (type === "int") {
            attrs.push("step=\"1\"");
        } else {
            attrs.push("step=\"0.01\"");
        }
    } else if (type === "date") {
        attrs.push("type=\"date\"");
    } else if (type === "datetime") {
        attrs.push("type=\"datetime-local\"");
    } else if (type === "time") {
        attrs.push("type=\"time\"");
    } else {
        attrs.push("type=\"text\"");
    }

    html.push(...[
        `    <input id="${id}" ${attrs.join(' ')} class="input">`
    ]);

    script.push(...[
        `${field} = parseInputValue("${id}", "${type}");`,
        `if (!${field}) {`,
        `    alert(\"The field ${key} is required.\");`,
        `    return undefined;`,
        "}"
    ]);

    if (mappingKey) {
        inputMappingScript.push(`INPUT_MAPPING["${mappingKey}"] = "${id}";`);
    }
}

function randomElementId(): string {
    return "_" + Math.random().toString(36).substring(2, 15);
}