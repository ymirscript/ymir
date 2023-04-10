/**
 * Defines a plugin which adds a target language to the Ymir compiler.
 */
export interface ITarget {
    /**
     * The name of the target language but also the identifier for this language. 
     * 
     * @remarks The name must match the pattern `[_a-zA-Z][_a-zA-Z0-9]`
     * 
     * @code In ymir this would be: `target <Name>;`
     */
    readonly name: string;
}