import type { JSONSchema } from '@apidevtools/json-schema-ref-parser';
import RefParser from '@apidevtools/json-schema-ref-parser';
import type {
	JSONSchema4,
	JSONSchema6Definition,
	JSONSchema7Definition,
} from 'json-schema';
import fs from 'fs';
import clone from 'clone';
import type { Options, SchemaType, SchemaTypeKeys } from './types';
import { getVocabulary, schemaWalk, vocabularies } from './lib/walker';

const oas3schema = JSON.parse(
	fs.readFileSync('./refs/oas3-schema.json', 'utf8')
);

class InvalidTypeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidTypeError';
		this.message = message;
	}
}

const oasExtensionPrefix = 'x-';

// TODO: having definitions inside an oas3 schema isn't exactly valid,
// maybe it is an idea to extract and split them into multiple oas3 schemas and reference to them.
// For now leaving as is.
const allowedKeywords = [
	'$ref',
	'definitions',
	...Object.keys(oas3schema.definitions.Schema.properties),
];

function isCyclic(obj: any) {
	const seenObjects = new Set();

	function detect(obj: any) {
		if (obj && typeof obj === 'object') {
			if (seenObjects.has(obj)) {
				return true;
			}
			seenObjects.add(obj);
			for (const key in obj) {
				// eslint-disable-next-line no-prototype-builtins
				if (obj.hasOwnProperty(key) && detect(obj[key])) {
					return true;
				}
			}
		}
		return false;
	}

	return detect(obj);
}

const convert = async <T = JSONSchema>(
	schema: T,
	options?: Options
): Promise<SchemaType> => {
	const {
		cloneSchema = true,
		dereference = false,
		useRefIfCycleFound = true,
	} = options || {};
	let schemaToUse = schema as SchemaType;

	if (cloneSchema) {
		schemaToUse = clone(schema);
	}

	const parser = new RefParser();
	if (dereference) {
		// We run the risk of circular references here
		const res = await parser.dereference(schema, {
			dereference: {
				circular: useRefIfCycleFound ? 'ignore' : true,
			},
		});
		schemaToUse = res as SchemaType;
	}

	const vocab = getVocabulary(schemaToUse, vocabularies.DRAFT_04);
	schemaWalk(schemaToUse, convertSchema, null, vocab);
	return schemaToUse;
};

function stripIllegalKeywords(schema: SchemaType) {
	if (typeof schema !== 'object') {
		return schema;
	}
	delete schema['$schema'];
	delete schema['$id'];
	if ('id' in schema) {
		delete schema['id'];
	}
	return schema;
}

function convertSchema(schema: SchemaType | undefined) {
	if (!schema) {
		return schema;
	}
	schema = stripIllegalKeywords(schema);
	schema = convertTypes(schema);
	schema = rewriteConst(schema);
	schema = convertDependencies(schema);
	schema = rewriteIfThenElse(schema);
	schema = rewriteExclusiveMinMax(schema);
	schema = convertExamples(schema);

	if (typeof schema['patternProperties'] === 'object') {
		schema = convertPatternProperties(schema);
	}

	if (schema.type === 'array' && typeof schema.items === 'undefined') {
		schema.items = {};
	}

	// should be called last
	schema = convertIllegalKeywordsAsExtensions(schema);
	return schema;
}

function validateType(type: string | string[]) {
	const validTypes = [
		'null',
		'boolean',
		'object',
		'array',
		'number',
		'string',
		'integer',
	];
	const types = Array.isArray(type) ? type : [type];
	types.forEach((type) => {
		if (validTypes.indexOf(type) < 0 && type !== undefined)
			throw new InvalidTypeError('Type "' + type + '" is not a valid type');
	});
}

function convertDependencies(schema: SchemaType) {
	const deps = schema.dependencies;
	if (typeof deps !== 'object') {
		return schema;
	}

	// Turns the dependencies keyword into an allOf of oneOf's
	// "dependencies": {
	// 		"post-office-box": ["street-address"]
	// },
	//
	// becomes
	//
	// "allOf": [
	// 	{
	// 		"oneOf": [
	// 			{"not": {"required": ["post-office-box"]}},
	// 			{"required": ["post-office-box", "street-address"]}
	// 		]
	// 	}
	//

	delete schema['dependencies'];
	if (!Array.isArray(schema.allOf)) {
		schema.allOf = [];
	}

	for (const key in deps) {
		const foo: (JSONSchema4 & JSONSchema6Definition) & JSONSchema7Definition = {
			oneOf: [
				{
					not: {
						required: [key],
					},
				},
				{
					required: [key, deps[key]].flat() as string[],
				},
			],
		};
		schema.allOf.push(foo);
	}
	return schema;
}

function convertTypes(schema: SchemaType) {
	if (typeof schema !== 'object') {
		return schema;
	}
	if (schema.type === undefined) {
		return schema;
	}

	validateType(schema.type);

	if (Array.isArray(schema.type)) {
		if (schema.type.includes('null')) {
			schema.nullable = true;
		}
		const typesWithoutNull = schema.type.filter((type) => type !== 'null');
		if (typesWithoutNull.length === 0) {
			delete schema.type;
		} else if (typesWithoutNull.length === 1) {
			schema.type = typesWithoutNull[0];
		} else {
			delete schema.type;
			schema.anyOf = typesWithoutNull.map((type) => ({ type }));
		}
	} else if (schema.type === 'null') {
		delete schema.type;
		schema.nullable = true;
	}

	return schema;
}

// "patternProperties did not make it into OpenAPI v3.0"
// https://github.com/OAI/OpenAPI-Specification/issues/687
function convertPatternProperties(schema: SchemaType) {
	schema['x-patternProperties'] = schema['patternProperties'];
	delete schema['patternProperties'];
	schema.additionalProperties ??= true;
	return schema;
}

// keywords (or property names) that are not recognized within OAS3 are rewritten into extensions.
function convertIllegalKeywordsAsExtensions(schema: SchemaType) {
	const keys = Object.keys(schema) as SchemaTypeKeys[];
	keys
		.filter(
			(keyword) =>
				!keyword.startsWith(oasExtensionPrefix) &&
				!allowedKeywords.includes(keyword)
		)
		.forEach((keyword: SchemaTypeKeys) => {
			const key = `${oasExtensionPrefix}${keyword}` as keyof SchemaType;
			schema[key] = schema[keyword];
			delete schema[keyword];
		});
	return schema;
}

function convertExamples(schema: SchemaType) {
	if (schema['examples'] && Array.isArray(schema['examples'])) {
		schema['example'] = schema['examples'][0];
		delete schema['examples'];
	}

	return schema;
}

function rewriteConst(schema: SchemaType) {
	if (Object.hasOwnProperty.call(schema, 'const')) {
		schema.enum = [schema.const];
		delete schema.const;
	}
	return schema;
}

function rewriteIfThenElse(schema: SchemaType) {
	if (typeof schema !== 'object') {
		return schema;
	}
	/* @handrews https://github.com/OAI/OpenAPI-Specification/pull/1766#issuecomment-442652805
  if and the *Of keywords

  There is a really easy solution for implementations, which is that

  if: X, then: Y, else: Z

  is equivalent to

  oneOf: [allOf: [X, Y], allOf: [not: X, Z]]
  */
	if ('if' in schema && schema.if && schema.then) {
		schema.oneOf = [
			{ allOf: [schema.if, schema.then] },
			{ allOf: [{ not: schema.if }, schema.else] },
		];
		delete schema.if;
		delete schema.then;
		delete schema.else;
	}
	return schema;
}

function rewriteExclusiveMinMax(schema: SchemaType) {
	if (typeof schema.exclusiveMaximum === 'number') {
		schema.maximum = schema.exclusiveMaximum;
		schema.exclusiveMaximum = true;
	}
	if (typeof schema.exclusiveMinimum === 'number') {
		schema.minimum = schema.exclusiveMinimum;
		schema.exclusiveMinimum = true;
	}
	return schema;
}

export default convert;
