import { IPluginContext } from "./context.ts";

/**
 * The base class for plugins.
 */
export abstract class PluginBase {

    /**
     * Gets called when the plugin should compile the context.
     * 
     * @param context The context in which the plugin is executed.
     */
    public abstract compile(context: IPluginContext): void;

    /**
     * The name of the target language but also the identifier for this language. 
     * 
     * @remarks The name must match the pattern `[_a-zA-Z][_a-zA-Z0-9]`
     * 
     * @code In ymir this would be: `target <Name>;`
     */
    public get targetFor(): string|undefined {
        return undefined;
    }
}