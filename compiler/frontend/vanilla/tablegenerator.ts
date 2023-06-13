import { AbortError, FrontendType, Logger, ProjectNode, RouteNode } from "../../../library/mod.ts";
import { Method } from "../../../library/script/nodes.ts";
import { VanillaGenerator } from "./index.ts";

/**
 * Generates a table view for the given route.
 * 
 * @param parentPath The path of the parent route.
 * @param route The route to generate the list for.
 * @param proj The project node.
 * @param integrates The list of integrations.
 */
export function generateTable(parentPath: string, route: RouteNode, integrates: string[], proj: ProjectNode, generator: VanillaGenerator): string[] {
    if (!route.response || !route.rendering || route.rendering.type !== FrontendType.Table) {
        throw new Error(`The route ${route.path} does not have a response.`);
    }

    if (route.method !== "GET" && route.isResponsePlural !== true) {
        throw new Error(`The route ${route.path} does not support tables.`);
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

    // deno-lint-ignore no-explicit-any
    const getColumnNames = (obj: any, prefix: string) => {
        const columns: string[] = [];

        for (const key in obj) {
            if (typeof obj[key] === "object") {
                columns.push(...getColumnNames(obj[key], `${prefix}${key}.`));
            } else {
                columns.push(`${prefix}${key}`);
            }
        }

        return columns;
    };

    const columns = getColumnNames(route.response, "");

    return [
        "<table class=\"table\">",
        "    <thead>",
        "        <tr>",
        ...columns.map((column) => `            <th>${column}</th>`),
        "            <th>Actions</th>",
        "        </tr>",
        "    </thead>",
        "    <tbody id=\"tablebody\">",
        "       <tr>Loading...</tr>",
        "    </tbody>",
        "</table>",
        "<script>",
        ...integratesCode,
        "function load() {",
        `    restClient.get("${parentPath}${parentPath.endsWith("/") ? '' : '/'}${(route.path.path.startsWith("/") ? route.path.path.substring(1) : route.path.path)}")`,
        "        .then((response) => {",
        "            const tb = document.getElementById(\"tablebody\");",
        "            if (tb === null) {",
        "                return;",
        "            }",
        "",
        "            tb.innerHTML = \"\";",
        "",
        "            for (const item of response.data) {",
        "                const tr = document.createElement(\"tr\");",
        ...columns.map((column) => `                const ${column.replace(".", "_")} = document.createElement(\"td\");`),
        "                const actions = document.createElement(\"td\");",
        "",
        ...columns.map((column) => `                ${column.replace(".", "_")}.innerText = item.${column};`),
        "",
        ...integrateMethods.map((method) => {
            if (method === Method.Delete) {
                return `                const deleteButton = document.createElement(\"button\");\n` +
                    `                deleteButton.innerText = \"Delete\";\n` +
                    `                deleteButton.onclick = () => deleteItem(item.id);\n` +
                    `                actions.appendChild(deleteButton);\n` +
                    `                `;
            } else if (method === Method.Patch) {
                return `                const editButton = document.createElement(\"button\");\n` +
                    `                editButton.innerText = \"Edit\";\n` +
                    `                editButton.onclick = () => editItem(item.id);\n` +
                    `                actions.appendChild(editButton);\n` +
                    `                `;
            } else if (method === Method.Get) {
                return `                const viewButton = document.createElement(\"button\");\n` +
                    `                viewButton.innerText = \"View\";\n` +
                    `                viewButton.onclick = () => viewItem(item.id);\n` +
                    `                actions.appendChild(viewButton);\n` +
                    `                `;
            }
            return "";
        }),
        "",
        ...columns.map((column) => `                tr.appendChild(${column.replace(".", "_")});`),
        "                tr.appendChild(actions);",
        "                tb.appendChild(tr);",
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