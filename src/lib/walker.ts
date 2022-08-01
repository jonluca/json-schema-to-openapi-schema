/**
 * Originally from https://raw.githubusercontent.com/cloudflare/json-schema-tools/master/workspaces/json-schema-walker/lib/schemaWalk.js
 *
 * But that has become abandon ware, and has not accepted any PRs in years. This is the same library, just rewritten in TS
 * and with support for circular references
 */
import type { JSONSchema } from '@apidevtools/json-schema-ref-parser';
import type { JSONSchema4, JSONSchema6, JSONSchema7 } from 'json-schema';
// Custom walker for the tree-walk package that only visits schemas.
const NEXT_SCHEMA_KEYWORD = 'schemaWalk:nextSchemaKeyword';
const NEXT_LDO_KEYWORD = 'schemaWalk:nextLdoKeyword';
type Path = string | number;

type ModFunc = (
	schema: JSONSchema | undefined,
	path?: Path[],
	originalSchema?: JSONSchema | undefined,
	parentPath?: Path[]
) => void;
type ModifierFunction = ModFunc | null;

type ParserFunction = (
	schema: Record<string | number, any>,
	keyword: Path | Path[],
	preFunc: ModifierFunction,
	postFunc: ModifierFunction,
	parentPath: Path[]
) => void;

/**
 * Examine each possibly-subschema-containing keyword and apply
 * the callbacks to each subschema.  As links are more complex,
 * they are handed off to _processLinks();
 */

/**
 * Utility function for getting a subschema when
 * then number of path components is unknown.
 * Often useful in implementing callbacks that want to look
 * at the parent schema in some way.
 *
 * Returns undefined if the path cannot be fully applied.
 */
const getSubschema = function (schema: JSONSchema, path: Path[]) {
	let subschema = schema;
	for (const p of path) {
		if (subschema === undefined) {
			return undefined;
		}
		subschema = subschema[p as keyof JSONSchema];
	}
	return subschema;
};

type IVocabulary = typeof vocabularies[keyof typeof vocabularies];
/**
 * Get a vocabulary based on the $schema keyword, defaulting
 * to the most recent hyper-schema if none is present.
 */
const getVocabulary = function (
	schema: JSONSchema,
	defaultVocabulary?: IVocabulary
) {
	let vocabulary;
	if (schema.$schema) {
		try {
			vocabulary = {
				'http://json-schema.org/draft-04/schema#': DRAFT_04,
				'http://json-schema.org/draft-04/hyper-schema#': DRAFT_04_HYPER,
				'http://json-schema.org/draft-06/schema#': DRAFT_06,
				'http://json-schema.org/draft-06/hyper-schema#': DRAFT_06_HYPER,
				'http://json-schema.org/draft-07/schema#': DRAFT_07,
				'http://json-schema.org/draft-07/hyper-schema#': DRAFT_07_HYPER,
			}[schema.$schema];
		} catch (e) {
			// fall through to default below
		}
	}
	vocabulary ??= defaultVocabulary || DRAFT_07_HYPER;
	return vocabulary;
};

/**
 * Walk the entire schema, including the root schema.
 */
const schemaWalk = <T extends JSONSchema>(
	schema: T,
	preFunc: ModifierFunction,
	postFunc: ModifierFunction,
	vocabulary: IVocabulary
) => {
	preFunc?.(schema, [], undefined, []);
	subschemaWalk(schema, preFunc, postFunc, [], vocabulary);
	postFunc?.(schema, [], undefined, []);
};

/**
 * Walk a schema's subschemas.  The root schema is NOT
 * passed to the callbacks.  To include the root schema,
 * call schemaWalk().
 *
 * Deleting entire keywords is supported and handled
 * through the NEXT_SCHEMA_KEYWORD exception.
 *
 * Except for LDO keywords (see _processLinks()), deleting
 * specific subschemas from an object of subschemas, or
 * from a list of subschemas, is not supported and will
 * result in undefined behavior.
 */
const subschemaWalk = (
	schema: JSONSchema,
	preFunc: ModifierFunction,
	postFunc: ModifierFunction,
	parentPath: Path[],
	vocabulary?: IVocabulary
) => {
	if (parentPath === undefined) {
		// Treat our parent schema as a root schema.
		parentPath = [];
	}

	if (!_isSchema(schema)) {
		throw (
			'Expected object or boolean as schema, got ' +
			(Array.isArray(schema) ? 'array' : typeof schema)
		);
	}

	vocabulary ??= getVocabulary(schema);

	for (const keyword in schema) {
		try {
			_processSchemaKeyword(
				vocabulary,
				schema,
				keyword,
				preFunc,
				postFunc,
				parentPath
			);
		} catch (e) {
			if (e !== NEXT_SCHEMA_KEYWORD) {
				throw e;
			}
		}
	}
};

/**
 * Determine if something is (probably) a schema or not.
 * This is currently just a check for an object or a boolean,
 * which is the requirement for draft-06 or later.
 *
 * It is assumed that if strict draft-04 compliance is desired,
 * meta-schema validation will screen out any booleans for
 * keywords other than additionalProperties and additionalItems.
 *
 * Otherwise, this package will tolerate boolean schemas with
 * draft-04.
 */
const _isSchema = (schema: JSONSchema | keyof JSONSchema) =>
	(schema instanceof Object && !Array.isArray(schema)) ||
	typeof schema === 'boolean';

const _processSchemaKeyword = (
	vocabulary: IVocabulary,
	schema: JSONSchema,
	keyword: Path,
	preFunc: ModifierFunction,
	postFunc: ModifierFunction,
	parentPath: Path[]
) => {
	const vocabularyCallback = vocabulary?.[keyword as keyof IVocabulary];
	if (vocabularyCallback) {
		(vocabularyCallback as any)?.(
			schema,
			keyword,
			preFunc,
			postFunc,
			parentPath
		);
	}
};

/**
 * Apply callbacks to a single schema.
 */
const _processSingleSchema = function (
	schema: JSONSchema,
	keyword: Path,
	preFunc: ModifierFunction,
	postFunc: ModifierFunction,
	parentPath: Path[]
) {
	_apply(schema, [keyword], preFunc, postFunc, parentPath);
};

/**
 * Apply callbacks to each schema in an array.
 */
const _processArrayOfSchemas = function (
	schema: JSONSchema,
	keyword: Path,
	preFunc: ModifierFunction,
	postFunc: ModifierFunction,
	parentPath: Path[]
) {
	for (let i = 0; i < schema[keyword as keyof JSONSchema].length; i++) {
		_apply(schema, [keyword, i], preFunc, postFunc, parentPath);
	}
};

/**
 * Apply callbacks to either a single schema or an array of schemas
 */
const _processSingleOrArrayOfSchemas = function (
	schema: JSONSchema,
	keyword: Path,
	preFunc: ModifierFunction,
	postFunc: ModifierFunction,
	parentPath: Path[]
) {
	if (_isSchema(schema[keyword as keyof JSONSchema])) {
		_processSingleSchema(schema, keyword, preFunc, postFunc, parentPath);
	} else {
		_processArrayOfSchemas(schema, keyword, preFunc, postFunc, parentPath);
	}
};

/**
 * Apply callbacks to each schema in an object.
 */
const _processObjectOfSchemas = function (
	schema: JSONSchema,
	keyword: Path,
	preFunc: ModifierFunction,
	postFunc: ModifierFunction,
	parentPath: Path[]
) {
	for (const prop of Object.getOwnPropertyNames(
		schema[keyword as keyof JSONSchema]
	)) {
		_apply(schema, [keyword, prop], preFunc, postFunc, parentPath);
	}
};

/**
 * Apply callbacks to each schema in an object, where each
 * property may hold either a subschema or something that
 * is recognizably not a schema, such as a string or number.
 */
const _processObjectOfMaybeSchemas = function (
	schema: JSONSchema,
	keyword: Path,
	preFunc: ModifierFunction,
	postFunc: ModifierFunction,
	parentPath: Path[]
) {
	for (const prop of Object.getOwnPropertyNames(
		schema[keyword as keyof JSONSchema]
	)) {
		if (_isSchema(schema[keyword as keyof JSONSchema][prop])) {
			_apply(schema, [keyword, prop], preFunc, postFunc, parentPath);
		}
	}
};

/**
 * Loop over the links and apply the callbacks, while
 * handling LDO keyword deletions by catching NEXT_LDO_KEYWORD.
 */
const _getProcessLinks = function (ldoVocabulary: IVocabulary) {
	return function (
		schema: Record<string | number, any>,
		keyword: Path,
		preFunc: ModifierFunction,
		postFunc: ModifierFunction,
		parentPath: Path[]
	) {
		for (let i = 0; i < schema.links.length; i++) {
			const ldo = schema.links[i];
			for (const keyword in ldo) {
				try {
					// @ts-ignore
					ldoVocabulary[keyword]?.(
						schema,
						['links', i, keyword],
						preFunc,
						postFunc,
						parentPath
					);
				} catch (e) {
					if (e !== NEXT_LDO_KEYWORD) {
						throw e;
					}
				}
			}
		}
	};
};

/**
 * Actually call the callbacks.
 *
 * If the preFunc callback deletes the entire keywords,
 * this throws NEXT_SCHEMA_KEYWORD.
 *
 * If it deletes a keyword within an LDO, it throws NEXT_LDO_KEYWORD.
 *
 * These exceptions allow callers to break out of loops that
 * would otherwise attempt to continue processing deleted subschemas.
 */
const _apply = (
	schema: Record<string | number, any>,
	path: Path[],
	preFunc: ModifierFunction,
	postFunc: ModifierFunction,
	parentPath: Path[]
) => {
	let subschema = getSubschema(schema, path);

	preFunc?.(subschema, path, schema, parentPath);

	// Make sure we did not remove or change the subschema in question.
	subschema = getSubschema(schema, path);
	if (subschema === undefined) {
		if (path[0] === 'links' && schema.links !== undefined) {
			// Deleting the LDO keywords is allowed.  Deleting an entire
			// LDO is not and is documented to produce undefined behavior
			// so we do not check for it.
			throw NEXT_LDO_KEYWORD;
		}
		throw NEXT_SCHEMA_KEYWORD;
	}
	subschemaWalk(subschema, preFunc, postFunc, parentPath.concat(path));
	postFunc?.(subschema, path, schema, parentPath);
};

const DRAFT_04 = {
	properties: _processObjectOfSchemas,
	patternProperties: _processObjectOfSchemas,
	additionalProperties: _processSingleSchema,
	dependencies: _processObjectOfMaybeSchemas,
	items: _processSingleOrArrayOfSchemas,
	additionalItems: _processSingleSchema,
	allOf: _processArrayOfSchemas,
	anyOf: _processArrayOfSchemas,
	oneOf: _processArrayOfSchemas,
	not: _processSingleSchema,
	if: _processSingleSchema,
	then: _processSingleSchema,
	else: _processSingleSchema,
} as Record<keyof JSONSchema4, ParserFunction>;

/**
 * LDO keywords call _apply directly as they have a different
 * mapping from the schema keyword into the path that _apply
 * expects.  This is done in the function returned from
 * _getProcessLinks();
 */
const DRAFT_04_HYPER_LDO = {
	schema: _apply,
	targetSchema: _apply,
};

const DRAFT_04_HYPER = {
	...DRAFT_04,
	links: _getProcessLinks(DRAFT_04_HYPER_LDO),
} as Record<string, ParserFunction>;

const DRAFT_06 = {
	...DRAFT_04,
	propertyNames: _processObjectOfSchemas,
} as Record<keyof JSONSchema6, ParserFunction>;

const DRAFT_06_HYPER_LDO = {
	hrefSchema: _apply,
	targetSchema: _apply,
	submissionSchema: _apply,
};

const DRAFT_06_HYPER = {
	...DRAFT_06,
	links: _getProcessLinks(DRAFT_06_HYPER_LDO),
} as Record<keyof JSONSchema6, ParserFunction>;

const DRAFT_07 = { ...DRAFT_06 } as Record<keyof JSONSchema7, ParserFunction>;

const DRAFT_07_HYPER_LDO = {
	...DRAFT_06_HYPER_LDO,
	headerSchema: _apply,
} as Record<string, ParserFunction>;

const DRAFT_07_HYPER = {
	...DRAFT_07,
	links: _getProcessLinks(DRAFT_07_HYPER_LDO),
} as Record<string, ParserFunction>;

const CLOUDFLARE_DOCA = {
	...DRAFT_04,
	links: _getProcessLinks({ ...DRAFT_04_HYPER_LDO, ...DRAFT_07_HYPER_LDO }),
} as Record<string, ParserFunction>;

const vocabularies = {
	DRAFT_04,
	DRAFT_04_HYPER,
	DRAFT_04_HYPER_LDO,
	DRAFT_06,
	DRAFT_06_HYPER,
	DRAFT_06_HYPER_LDO,
	DRAFT_07,
	DRAFT_07_HYPER,
	DRAFT_07_HYPER_LDO,
	CLOUDFLARE_DOCA,
} as const;
export { getSubschema, getVocabulary, schemaWalk, subschemaWalk, vocabularies };
