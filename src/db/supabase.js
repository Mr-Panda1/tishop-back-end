const env  = require('./env');
const supabaseClient = require('@supabase/supabase-js');

const supabase = supabaseClient.createClient(
    env.supabaseUrl,
    env.supabaseSecret
)

module.exports = supabase;