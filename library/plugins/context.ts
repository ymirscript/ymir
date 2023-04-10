import { IYmirFile } from "../script/file.ts";

/**
 * The plugin context describes the context in which the plugin is executed and the project is built.
 */
export interface IPluginContext {
    /**
     * Contains the path to the working directory of the target project.
     */
    readonly workingDirectory: string;
    /**
     * Contains the path to the index ymir file which is the entry point of the project.
     */
    readonly indexFile: string;
    /**
     * An array of all ymir files which are part of the project.
     */
    readonly files: IYmirFile[];
}