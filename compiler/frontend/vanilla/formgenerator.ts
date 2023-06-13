import { AbortError, FrontendType, Logger, Method, MiddlewareOptions, RouteNode } from "../../../library/mod.ts";

/**
 * Generates a form for the given route.
 * 
 * @param parentPath The path of the parent route.
 * @param route The route to generate the form for.
 */
export function generateForm(parentPath: string, route: RouteNode): string[] {
    if (!route.body || !route.rendering || route.rendering.type !== FrontendType.Form) {
        throw new Error(`The route ${route.path} does not have a body.`);
    }

    if (route.method !== "POST" && route.method !== "PATCH") {
        throw new Error(`The route ${route.path} does not support forms.`);
    }

    const axiosMethod = route.method === "POST" ? "post" : "patch";
    let axiosUrl = `${parentPath}${parentPath.endsWith("/") ? '' : '/'}${(route.path.path.startsWith("/") ? route.path.path.substring(1) : route.path.path)}`;

    if (route.rendering.options && route.rendering.options["updateId"] && typeof route.rendering.options["updateId"] === "string") {
        axiosUrl = axiosUrl.replace(route.rendering.options["updateId"], "${id}");
    }

    const html: string[] = [];
    const script: string[] = [];

    parseObject(html, script, route.body, false, 0, "body");
    
    return [
        "<form onsubmit=\"return false;\">",
        ...html.map((line) => `    ${line}`),
        "    <button class=\"button\" onclick=\"send()\">Submit</button>",
        "</form>",
        "<script>",
        ...[
            ...(route.method !== Method.Patch ? [] : [
                `const id = new URLSearchParams(window.location.search).get("id");`,
                `if (id === null) {`,
                `    alert("The id is required.");`,
                `    window.location.href = "/";`,
                `}`,
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
            "}"
        ].map((line) => `    ${line}`),
        "</script>"
    ]
}

function parseObject(html: string[], script: string[], object: MiddlewareOptions, useGroup: boolean, indentNr: number, fieldPath: string) {
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

            parseObject(innerHtml, innerScript, value as MiddlewareOptions, true, useGroup ? 1 : 0, `${fieldPath}["${key}"]`);
        } else if (typeof value === "string") {
            parseSimpleInput(innerHtml, innerScript, key, value, `${fieldPath}["${key}"]`);
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

function parseSimpleInput(html: string[], script: string[], key: string, type: string, field: string) {
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

}

function randomElementId(): string {
    return "_" + Math.random().toString(36).substring(2, 15);
}