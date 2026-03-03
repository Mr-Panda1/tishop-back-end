// Password validation to match Supabase requirements
// Min length: 8
// Lowercase, uppercase, digits, and symbols required

const validatePassword = (password) => {
    const errors = [];

    // Check minimum length
    if (!password || password.length < 8) {
        errors.push('Le mot de passe doit contenir au moins 8 caractères');
    }

    // Check for lowercase letters
    if (!/[a-z]/.test(password)) {
        errors.push('Le mot de passe doit contenir au moins une lettre minuscule');
    }

    // Check for uppercase letters
    if (!/[A-Z]/.test(password)) {
        errors.push('Le mot de passe doit contenir au moins une lettre majuscule');
    }

    // Check for digits
    if (!/\d/.test(password)) {
        errors.push('Le mot de passe doit contenir au moins un chiffre');
    }

    // Check for special characters/symbols
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
        errors.push('Le mot de passe doit contenir au moins un caractère spécial (!@#$%^&* etc)');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
};

module.exports = { validatePassword };
