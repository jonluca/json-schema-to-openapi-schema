import convert from '../src';
import should from 'should';
import { getSchema } from './helpers';

['basic', 'address', 'calendar', 'events'].forEach((test) => {
	it(`converts ${test}/openapi.json`, async () => {
		const schema = getSchema(test + '/json-schema.json');
		const result = await convert(schema);

		const expected = getSchema(test + '/openapi.json');

		should(result).deepEqual(expected, 'converted');
	});

	it(`converting ${test}/openapi.json in place`, async () => {
		const schema = getSchema(test + '/json-schema.json');
		const result = await convert(schema, { cloneSchema: false });
		const expected = getSchema(test + '/openapi.json');

		should(schema).deepEqual(result, 'changed schema in place');
		should(result).deepEqual(expected, 'converted');
	});
});
