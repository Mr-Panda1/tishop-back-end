const fs = require('fs');
const path = require('path');
const supabase = require('./src/db/supabase');

async function runMigration() {
    try {
        const migrationPath = path.join(__dirname, 'db/migrations/2026-02-20_rls-policies-final.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log('🚀 Running RLS policies migration...\n');
        
        const { data, error } = await supabase.rpc('exec_sql', {
            sql_query: sql
        }).catch(() => {
            // If exec_sql doesn't exist, try direct query execution
            return supabase.query(sql);
        });

        if (error) {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        }

        console.log('✅ Migration completed successfully!');
        console.log('\n📋 Changes applied:');
        console.log('  - Added USERS table RLS policies');
        console.log('  - Allow backend (service_role) to INSERT new users');
        console.log('  - Allow authenticated users to SELECT/UPDATE their own profile');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error running migration:', err.message);
        process.exit(1);
    }
}

runMigration();
