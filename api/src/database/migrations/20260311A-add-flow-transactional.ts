import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_flows', (table) => {
		table.boolean('transactional').defaultTo(false).notNullable();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_flows', (table) => {
		table.dropColumn('transactional');
	});
}
