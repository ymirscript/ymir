import { IYmirFile } from "../script/file.ts";
import { ProjectNode } from "../script/nodes.ts";

/**
 * The plugin context describes the context in which the plugin is executed and the project is built.
 */
export interface IPluginContext {
    /**
     * Contains the path to the working directory of the target project.
     */
    readonly workingDirectory: string;
    /**
     * Contains the path to the output directory of the target project.
     */
    readonly outputDirectory: string;
    /**
     * Contains the path to the index ymir file which is the entry point of the project.
     * 
     * @remarks Can be undefined if the pre-compilation (lexing, parsing) process fails.
     */
    readonly indexFile: IYmirFile;
    /**
     * Contains the project node of the index ymir file.
     */
    readonly projectNode: ProjectNode;
    /**
     * Whether the index file is prepared for the plugin.
     */
    readonly isIndexFilePrepared: boolean;
}