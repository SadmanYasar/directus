/**
 * Test script to verify policy merging behavior
 * This demonstrates the fix for the bug where combining policies does not merge fields correctly
 */

// Simulate the mergePermissions function behavior
function mergeFields(fieldsA, fieldsB, strategy) {
	if (fieldsA === null) fieldsA = [];
	if (fieldsB === null) fieldsB = [];

	let fields = [];

	if (strategy === 'and') {
		if (fieldsA.length === 0 || fieldsB.length === 0) return [];
		if (fieldsA.includes('*')) return fieldsB;
		if (fieldsB.includes('*')) return fieldsA;

		// Intersection
		fields = fieldsA.filter(f => fieldsB.includes(f));
	} else {
		if (fieldsA.length === 0) return fieldsB;
		if (fieldsB.length === 0) return fieldsA;

		if (fieldsA.includes('*') || fieldsB.includes('*')) return ['*'];

		// Union
		fields = [...new Set([...fieldsA, ...fieldsB])];
	}

	if (fields.includes('*')) return ['*'];

	return fields;
}

function mergePermission(strategy, currentPerm, newPerm) {
	const logicalKey = `_${strategy}`;

	let { permissions, fields } = currentPerm;

	// Merge permissions (access rules)
	if (newPerm.permissions) {
		if (currentPerm.permissions && Object.keys(currentPerm.permissions)[0] === logicalKey) {
			permissions = {
				[logicalKey]: [
					...currentPerm.permissions[logicalKey],
					newPerm.permissions,
				],
			};
		} else if (currentPerm.permissions) {
			// Empty {} supersedes other permissions in _OR merge
			if (strategy === 'or' && (JSON.stringify(currentPerm.permissions) === '{}' || JSON.stringify(newPerm.permissions) === '{}')) {
				permissions = {};
			} else {
				permissions = {
					[logicalKey]: [currentPerm.permissions, newPerm.permissions],
				};
			}
		} else {
			permissions = {
				[logicalKey]: [newPerm.permissions],
			};
		}
	}

	// Merge fields
	fields = mergeFields(currentPerm.fields, newPerm.fields, strategy);

	return {
		...currentPerm,
		permissions,
		fields,
	};
}

function mergePermissions(strategy, ...permissionsArrays) {
	const allPermissions = permissionsArrays.flat();

	const mergedPermissions = allPermissions.reduce((acc, val) => {
		const key = `${val.collection}__${val.action}`;
		const current = acc.get(key);
		acc.set(key, current ? mergePermission(strategy, current, val) : val);
		return acc;
	}, new Map());

	return Array.from(mergedPermissions.values());
}

// Test scenario from the bug report
console.log('=== Test Case: Bug Report Scenario ===\n');

const policy1Permissions = [
	{
		collection: 'CollectionA',
		action: 'read',
		policy: 'policy-1',
		fields: ['id', 'status', 'user_created', 'CollectionB'],
		permissions: {
			user_created: {
				id: {
					_eq: '$CURRENT_USER.id'
				}
			}
		}
	}
];

const policy2Permissions = [
	{
		collection: 'CollectionA',
		action: 'read',
		policy: 'policy-2',
		fields: ['id'],
		permissions: {
			CollectionB: {
				id: {
					_eq: '$CURRENT_USER.CollectionB.id'
				}
			}
		}
	}
];

console.log('Policy 1 permissions:');
console.log(JSON.stringify(policy1Permissions[0], null, 2));
console.log('\nPolicy 2 permissions:');
console.log(JSON.stringify(policy2Permissions[0], null, 2));

// Without merging (old buggy behavior)
console.log('\n--- WITHOUT merging (buggy behavior) ---');
console.log('Permissions would be kept separate, causing:');
console.log('- Items matching Policy 1 rule show only Policy 1 fields: [id, status, user_created, CollectionB]');
console.log('- Items matching Policy 2 rule show only Policy 2 fields: [id]');
console.log('- This is WRONG - fields should be combined!');

// With merging (fixed behavior)
console.log('\n--- WITH merging (correct behavior) ---');
const mergedPermissions = mergePermissions('or', policy1Permissions, policy2Permissions);
console.log('Merged permissions:');
console.log(JSON.stringify(mergedPermissions, null, 2));

console.log('\n✅ EXPECTED RESULT:');
console.log('All items that match ANY policy rule should show ALL fields from both policies:');
console.log('Fields: ' + JSON.stringify(mergedPermissions[0].fields));
console.log('This means ALL items should show: [id, status, user_created, CollectionB]');
console.log('Regardless of which access rule they match!');

console.log('\n=== Test Case: Multiple policies with different fields ===\n');

const testPolicies = [
	{
		collection: 'articles',
		action: 'read',
		policy: 'policy-1',
		fields: ['id', 'title', 'author'],
		permissions: { status: { _eq: 'published' } }
	},
	{
		collection: 'articles',
		action: 'read',
		policy: 'policy-2',
		fields: ['id', 'content', 'tags'],
		permissions: { author: { _eq: '$CURRENT_USER' } }
	},
	{
		collection: 'articles',
		action: 'read',
		policy: 'policy-3',
		fields: ['id', 'views'],
		permissions: { category: { _eq: 'public' } }
	}
];

console.log('Three policies with different fields:');
testPolicies.forEach((p, i) => {
	console.log(`  Policy ${i + 1}: ${JSON.stringify(p.fields)}`);
});

const merged = mergePermissions('or', testPolicies);
console.log('\nAfter OR merging:');
console.log('Fields: ' + JSON.stringify(merged[0].fields));
console.log('Access rules combined with _or:');
console.log(JSON.stringify(merged[0].permissions, null, 2));

console.log('\n✅ This means users get access to union of all fields when ANY rule matches!');
