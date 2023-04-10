// deno-lint-ignore no-unused-vars
import { IPluginContext } from "../plugins/context.ts";

/**
 * Represents a ymir file in the generation process.
 */
export interface IYmirFile {
    /**
     * The kind of the ymir file.
     */
    readonly kind: YmirFileKind;
    /**
     * The path to the ymir file.
     */
    readonly path: string;
    /**
     * The name of the ymir file without the base path {@link IPluginContext.workingDirectory} .
     */
    readonly filename: string;
}

/**
 * Describes the kind of a ymir file.
 */
export enum YmirFileKind {
    /**
     * *.ymr file which contains ymir code.
     */
    Script = "script",

    /**
     * *.ymrd file which contains ymir definitions for objects, headers, query or normal route parameters.
     */
    Definition = "definition",
}