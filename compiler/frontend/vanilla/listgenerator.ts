import { AbortError, FrontendType, Logger, ProjectNode, RouteNode } from "../../../library/mod.ts";
import { Method } from "../../../library/script/nodes.ts";
import { VanillaGenerator } from "./index.ts";

/**
 * Generates a list view for the given route.
 * 
 * @param parentPath The path of the parent route.
 * @param route The route to generate the list for.
 * @param proj The project node.
 * @param integrates The list of integrations.
 */
export function generateList(parentPath: string, route: RouteNode, integrates: string[], proj: ProjectNode, generator: VanillaGenerator): string[] {
    if (!route.response || !route.rendering || route.rendering.type !== FrontendType.List) {
        throw new Error(`The route ${route.path} does not have a response.`);
    }

    if (route.method !== "GET" && route.isResponsePlural !== true) {
        throw new Error(`The route ${route.path} does not support lists.`);
    }

    const integratesCode: string[] = [];
    const integrateMethods: Method[] = [];

    for (const integrateAlias of integrates) {
        const res = proj.findRouteByAlias(integrateAlias);
        if (!res) {
            Logger.error(`Could not find integration ${integrateAlias}.`);

            throw new AbortError();
        }

        const [integrateRoute, integrateParentPath] = res;

        if (integrateRoute.method === Method.Delete) {
            integratesCode.push(...[
                `    function deleteItem(id) {`,
                `        if (!confirm("Are you sure you want to delete this item?")) {`,
                `            return;`,
                `        }`,
                ``,
                `        restClient.delete(("${integrateParentPath}${integrateParentPath.endsWith("/") ? '' : '/'}${(integrateRoute.path.path.startsWith("/") ? integrateRoute.path.path.substring(1) : integrateRoute.path.path)}").replace(":id", id))`,
                `            .then(() => {`,
                `                load();`,
                `            })`,
                `            .catch((error) => {`,
                `                alert(error);`,
                `            });`,
                `    }`,
                ``
            ]);

            integrateMethods.push(Method.Delete);
        } else if (integrateRoute.method === Method.Patch) {
            integratesCode.push(...[
                `    function editItem(id) {`,
                `        window.location.href = "/${generator.getRouteFileName(integrateParentPath, integrateRoute)}?id=" + id;`,
                `    }`,
                ``
            ]);

            integrateMethods.push(Method.Patch);
        } else if (integrateRoute.method === Method.Get) {
            integratesCode.push(...[
                `    function viewItem(id) {`,
                `        window.location.href = "/${generator.getRouteFileName(integrateParentPath, integrateRoute)}?id=" + id;`,
                `    }`,
                ``
            ]);

            integrateMethods.push(Method.Get);
        }
    }

    return [
        "<ul class=\"list\" id=\"listview\">",
        "</ul>",
        "<script>",
        ...integratesCode,
        "function load() {",
        `    restClient.get("${parentPath}${parentPath.endsWith("/") ? '' : '/'}${(route.path.path.startsWith("/") ? route.path.path.substring(1) : route.path.path)}")`,
        "        .then((response) => {",
        "            const listview = document.getElementById(\"listview\");",
        "            if (listview === null) {",
        "                return;",
        "            }",
        "",
        "            listview.innerHTML = \"\";",
        "",
        "            for (const item of response.data) {",
        "                const li = document.createElement(\"li\");",
        `                li.innerHTML = \`${getListItemTemplate(integrateMethods)}\`;`,
        "                listview.appendChild(li);",
        "            }",
        "        })",
        "        .catch((error) => {",
        "            alert(error);",
        "        });",
        "}",
        "",
        "load();",
        "</script>"
    ];
}

function getListItemTemplate(integrates: Method[]): string {
    const template: string[] = [];

    template.push("<span>${JSON.stringify(item)}</span>");

    for (const integrate of integrates) {
        if (integrate === Method.Delete) {
            template.push(...[
                "<button class=\"button\" onclick=\"deleteItem(item.id)\">Delete</button>"
            ]);
        } else if (integrate === Method.Patch) {
            template.push(...[
                "<button class=\"button\" onclick=\"editItem(item.id)\">Edit</button>"
            ]);
        } else if (integrate === Method.Get) {
            template.push(...[
                "<button class=\"button\" onclick=\"viewItem(item.id)\">View</button>"
            ]);
        }
    }

    return template.join("");
}