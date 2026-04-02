const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const cors = require('cors');

const app = express();
const PORT = 3000;
const STORAGE_DIR = path.join(__dirname, 'uploads');
const PASSWORD_FILE = path.join(__dirname, 'password.json');

// Initialisation du dossier de stockage et du fichier mot de passe
fs.ensureDirSync(STORAGE_DIR);
// Initialisation sécurisée du fichier mot de passe
function initPasswordFile() {
    try {
        if (!fs.existsSync(PASSWORD_FILE)) {
            fs.writeJsonSync(PASSWORD_FILE, { password: 'admin123' });
            console.log('📝 Fichier password.json créé avec mot de passe par défaut: admin123');
        } else {
            // Vérifier si le fichier est valide JSON
            const content = fs.readFileSync(PASSWORD_FILE, 'utf8');
            if (!content.trim()) {
                throw new Error('Fichier vide');
            }
            JSON.parse(content);
        }
    } catch (err) {
        console.warn('⚠️ Fichier password.json corrompu, recréation...');
        fs.writeJsonSync(PASSWORD_FILE, { password: 'admin123' });
    }
}

initPasswordFile();

// Helper pour lire le mot de passe (avec relecture synchrone à chaque appel)
function getCurrentPassword() {
    try {
        const data = fs.readJsonSync(PASSWORD_FILE);
        return data.password;
    } catch (err) {
        console.error('Erreur lecture password.json, reset par défaut');
        const defaultPass = 'admin123';
        fs.writeJsonSync(PASSWORD_FILE, { password: defaultPass });
        return defaultPass;
    }
}

// Middleware
app.use(cors()); // autorise le front-end séparé
app.use(express.json());

// Helper : lire le mot de passe actuel
function getCurrentPassword() {
    return fs.readJsonSync(PASSWORD_FILE).password;
}

// Helper : mettre à jour le mot de passe
function setPassword(newPassword) {
    fs.writeJsonSync(PASSWORD_FILE, { password: newPassword });
}

// Helper : chemin sécurisé
function getSafeFilePath(location) {
    const safe = path.normalize(location).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(STORAGE_DIR, safe);
    if (!fullPath.startsWith(STORAGE_DIR)) {
        throw new Error('Invalid location');
    }
    return fullPath;
}

// Configuration multer (mémoire)
const upload = multer({ storage: multer.memoryStorage() });

// ---------- Endpoints API ----------

// 1. Upload (écrase si existant)
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        const { location } = req.body;
        if (!location || !req.file) {
            return res.status(400).json({ error: 'location et file requis' });
        }
        const filePath = getSafeFilePath(location);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, req.file.buffer);
        res.json({ success: true, location });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Accéder à un fichier (GET) - avec regex
app.get(/^\/api\/file\/(.*)$/, async (req, res) => {
    try {
        const location = req.params[0]; // tout ce qui est après /api/file/
        const filePath = getSafeFilePath(location);
        if (!await fs.pathExists(filePath)) {
            return res.status(404).send('Fichier non trouvé');
        }
        res.sendFile(filePath);
    } catch (err) {
        res.status(400).send('Chemin invalide');
    }
});

// 3. Supprimer un fichier (DELETE) - avec regex
app.delete(/^\/api\/file\/(.*)$/, async (req, res) => {
    try {
        const location = req.params[0];
        const filePath = getSafeFilePath(location);
        if (!await fs.pathExists(filePath)) {
            return res.status(404).json({ error: 'Fichier non trouvé' });
        }
        await fs.remove(filePath);
        res.json({ success: true, location });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Lister tous les fichiers (avec leurs chemins relatifs)
app.get('/api/list', async (req, res) => {
    try {
        const walk = async (dir, basePath = '') => {
            let results = [];
            const files = await fs.readdir(dir);
            for (const file of files) {
                const fullPath = path.join(dir, file);
                const relPath = basePath ? path.join(basePath, file) : file;
                const stat = await fs.stat(fullPath);
                if (stat.isDirectory()) {
                    results = results.concat(await walk(fullPath, relPath));
                } else {
                    results.push(relPath);
                }
            }
            return results;
        };
        const fileList = await walk(STORAGE_DIR);
        res.json({ files: fileList });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Télécharger tous les fichiers en ZIP (protégé par mot de passe)
app.get('/api/download-all', async (req, res) => {
    const { password } = req.query;
    if (password !== getCurrentPassword()) {
        return res.status(401).send('Mot de passe incorrect');
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=all_files.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);
    archive.directory(STORAGE_DIR, false);
    await archive.finalize();
});

// 6. Modifier le mot de passe (nécessite l'ancien)
app.post('/api/change-password', async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'oldPassword et newPassword requis' });
    }
    if (oldPassword !== getCurrentPassword()) {
        return res.status(403).json({ error: 'Ancien mot de passe incorrect' });
    }
    if (newPassword.length < 4) {
        return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 4 caractères' });
    }
    setPassword(newPassword);
    res.json({ success: true, message: 'Mot de passe modifié' });
});

// Démarrer le serveur
app.listen(PORT, () => {
    console.log(`API démarrée sur http://localhost:${PORT}`);
    console.log(`Mot de passe actuel : ${getCurrentPassword()}`);
});