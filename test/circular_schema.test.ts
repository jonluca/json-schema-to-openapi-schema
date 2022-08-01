import convert from '../src';
import { getSchema } from './helpers';
const test = 'circular';

it(`converts ${test}/openapi.json`, async ({ expect }) => {
	const schema = getSchema(test + '/json-schema.json');
	const result = await convert(schema, {
		dereference: true,
	});
	const expected = getSchema(test + '/openapi.json');
	expect(result).toEqual(expected);
});

it(`converting ${test}/openapi.json in place`, async ({ expect }) => {
	const schema = getSchema(test + '/json-schema.json');
	const result = await convert(schema, {
		cloneSchema: false,
		dereference: true,
	});
	const expected = getSchema(test + '/openapi.json');
	expect(schema).toEqual(result);
	expect(result).toEqual(expected);
});

it(`converting ${test}/openapi.json without circular references turned off `, async ({
	expect,
}) => {
	const schema = getSchema(test + '/json-schema.json');
	const result = await convert(schema, {
		cloneSchema: false,
		useRefIfCycleFound: false,
		dereference: true,
	});
	expect(result).toMatchSnapshot();
});
