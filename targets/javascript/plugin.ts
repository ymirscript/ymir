import { IPluginContext, PluginBase } from "../../library/mod.ts";

export default class JavaScriptTargetPlugin extends PluginBase {

    public compile(context: IPluginContext): void {
        if (context.indexFile === undefined) {
            return;
        }


    }

    public get targetFor(): string | undefined {
        return "JavaScript";
    }
}