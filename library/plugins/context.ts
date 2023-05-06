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

    /**
     * Contains workspace specific configuration for the target.
     */
    readonly configuration: {[key: string]: unknown};

    /**
     * The generation mode of the bearer authentication.
     */
    readonly bearerAuthGenerationMode: BearerAuthGenerationMode;
}

/**
 * The generation mode of the bearer authentication.
 */
export enum BearerAuthGenerationMode {
    /**
     * Generates no bearer boilerplate code only the required authentication methods which are getting called from the routes.
     */
    None = 'NONE',
    /**
     * Generates everything but the JWT generation and validation.
     */
    Basic = 'BASIC',
    /**
     * Generates everything.
     */
    Full = 'FULL',
}