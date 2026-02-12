const multer = require('multer');

const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowMimes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
        if (allowMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, AND JPG are allowed.'))
        }
    }
});

module.exports = upload;