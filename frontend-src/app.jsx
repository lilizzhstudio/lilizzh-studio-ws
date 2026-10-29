        const { useState, useEffect, useRef } = React;

        // Custom in-app dialog modal (never uses window.alert)
        function CustomModal({ isOpen, title, message, onClose, type = 'info' }) {
            if (!isOpen) return null;
            return (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
                    <div className="glass-panel max-w-md w-full p-6 rounded-3xl border border-white/10 glow-blue">
                        <div className="flex items-center space-x-3 mb-4">
                            <div className={`p-3 rounded-2xl ${type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                <i data-lucide={type === 'success' ? 'check-circle-2' : type === 'error' ? 'alert-triangle' : 'info'} className="w-6 h-6"></i>
                            </div>
                            <h3 className="text-xl font-bold text-white">{title}</h3>
                        </div>
                        <p className="text-gray-300 text-sm mb-6 leading-relaxed font-sans">{message}</p>
                        <div className="flex justify-end">
                            <button 
                                onClick={onClose}
                                className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-all shadow-lg shadow-blue-500/25"
                            >
                                Understood
                            </button>
                        </div>
                    </div>
                </div>
            );
        }


        // ==========================================
        // BACKEND CLIENT  (all secrets, passwords and permission checks live on the Python server)
        // ==========================================
        class ApiError extends Error {
            constructor(message, status) {
                super(message);
                this.status = status;
            }
        }

        // The custom header is required by the server on every write request (CSRF protection).
        const API_HEADERS = { 'X-Requested-With': 'lilizzh-web' };

        async function api(method, path, body) {
            const options = { method, credentials: 'same-origin', headers: { ...API_HEADERS } };
            if (body !== undefined) {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(body);
            }
            let response;
            try {
                response = await fetch('/api' + path, options);
            } catch (networkError) {
                throw new ApiError('Cannot reach the server. Please check your connection and try again.', 0);
            }
            let data = null;
            try { data = await response.json(); } catch (parseError) { /* empty body */ }
            if (!response.ok) {
                if (response.status === 401 && !path.startsWith('/auth/')) {
                    window.dispatchEvent(new Event('lz-unauthorized'));
                }
                throw new ApiError((data && data.detail) || 'Something went wrong. Please try again.', response.status);
            }
            return data;
        }

        function uploadFile(orderId, folder, file, onProgress) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const query = new URLSearchParams({ folder, name: file.name });
                xhr.open('POST', `/api/orders/${encodeURIComponent(orderId)}/files?${query}`);
                xhr.withCredentials = true;
                xhr.setRequestHeader('X-Requested-With', 'lilizzh-web');
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');
                xhr.upload.onprogress = (evt) => {
                    if (evt.lengthComputable) onProgress(Math.round((evt.loaded / evt.total) * 100));
                };
                xhr.onload = () => {
                    let data = null;
                    try { data = JSON.parse(xhr.responseText); } catch (parseError) { /* ignore */ }
                    if (xhr.status >= 200 && xhr.status < 300) resolve(data);
                    else reject(new ApiError((data && data.detail) || 'Upload failed. Please try again.', xhr.status));
                };
                xhr.onerror = () => reject(new ApiError('Upload failed. Please check your connection.', 0));
                xhr.send(file);
            });
        }

        // Rate card and editor roster are loaded from the server at start-up (see App).
        // Editor passcodes are NOT part of the roster any more.
        const RATE_CARD = [];

        const EDITORS_LIST = [];

        // Owner contact details. The server only sends these to signed-in people (or if PUBLIC_CONTACT=1).
        const CONTACT = { value: null };

        function ContactLinks({ variant, onSignIn }) {
            const c = CONTACT.value;
            if (!c) {
                return onSignIn ? (
                    <button type="button" onClick={onSignIn} className="flex items-center space-x-1.5 hover:text-blue-400 transition-colors">
                        <i data-lucide="lock" className="w-3.5 h-3.5 text-blue-400"></i>
                        <span>Sign in to contact the studio</span>
                    </button>
                ) : null;
            }
            const subject = encodeURIComponent('Video Production Inquiry - Lilizzh Studio');
            return (
                <>
                    {c.email && (
                        <a href={`mailto:${c.email}?subject=${subject}`} className="flex items-center space-x-1.5 hover:text-blue-400 transition-colors" title="Email Lilizzh Studio">
                            <i data-lucide="mail" className="w-3.5 h-3.5 text-blue-400"></i>
                            <span>{c.email}</span>
                        </a>
                    )}
                    {c.whatsapp && (
                        <a href={`https://wa.me/${c.whatsapp}`} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-1.5 hover:text-emerald-400 transition-colors text-emerald-400 font-bold" title="Direct WhatsApp">
                            <i data-lucide="message-circle" className="w-3.5 h-3.5"></i>
                            <span>{c.whatsappDisplay || c.whatsapp}</span>
                        </a>
                    )}
                </>
            );
        }

        function App() {
            const [ready, setReady] = useState(false);
            const [loadError, setLoadError] = useState('');
            const [loginModalOpen, setLoginModalOpen] = useState(false);
            const [modal, setModal] = useState({ isOpen: false, title: '', message: '', type: 'info' });

            // Who is signed in is decided by the server (secure HttpOnly cookie) - never by the browser.
            const [currentUser, setCurrentUser] = useState(null);
            const [orders, setOrders] = useState([]);
            const lastLocalChange = useRef(0);
            const [, setConfigVersion] = useState(0);

            // Rate card (with margins for admin) and contact details depend on who is signed in.
            const applyConfig = (config) => {
                RATE_CARD.splice(0, RATE_CARD.length, ...config.rateCard);
                CONTACT.value = config.contact || null;
                setConfigVersion(v => v + 1);
            };
            const refreshConfig = async () => {
                try { applyConfig(await api('GET', '/config')); } catch (err) { /* keep what is on screen */ }
            };
            const refreshRoster = async () => {
                try {
                    const roster = await api('GET', '/editors');
                    EDITORS_LIST.splice(0, EDITORS_LIST.length, ...roster.editors);
                    setConfigVersion(v => v + 1);
                } catch (err) { /* keep what is on screen */ }
            };

            const showAlert = (title, message, type = 'info') => {
                setModal({ isOpen: true, title, message, type });
            };

            // First load: public settings, editor roster and the current session.
            useEffect(() => {
                let cancelled = false;
                (async () => {
                    try {
                        const [config, roster, session] = await Promise.all([
                            api('GET', '/config'), api('GET', '/editors'), api('GET', '/auth/me')
                        ]);
                        if (cancelled) return;
                        applyConfig(config);
                        EDITORS_LIST.splice(0, EDITORS_LIST.length, ...roster.editors);
                        setCurrentUser(session.user);
                        setReady(true);
                    } catch (err) {
                        if (!cancelled) setLoadError(err.message);
                    }
                })();
                return () => { cancelled = true; };
            }, []);

            // Orders come from the server and only include what this user is allowed to see.
            const refreshOrders = async () => {
                const startedAt = Date.now();
                try {
                    const data = await api('GET', '/orders');
                    if (lastLocalChange.current > startedAt) return; // a newer local change is already on screen
                    setOrders(prev => JSON.stringify(prev) === JSON.stringify(data.orders) ? prev : data.orders);
                } catch (err) { /* a 401 is handled by the lz-unauthorized listener */ }
            };

            const upsertOrder = (order) => {
                lastLocalChange.current = Date.now();
                setOrders(prev => prev.some(o => o.id === order.id)
                    ? prev.map(o => o.id === order.id ? order : o)
                    : [order, ...prev]);
            };

            // Live-ish sync (replaces the old Firestore listener): poll while signed in.
            const userKey = currentUser ? `${currentUser.role}:${currentUser.email}` : '';
            useEffect(() => {
                if (ready) refreshConfig();
                if (!userKey) { setOrders([]); return; }
                refreshOrders();
                const timer = setInterval(() => { if (!document.hidden) refreshOrders(); }, 5000);
                return () => clearInterval(timer);
            }, [userKey, ready]);

            // Session expired or revoked on the server.
            useEffect(() => {
                const onUnauthorized = () => {
                    setCurrentUser(prev => {
                        if (prev) showAlert('Session Expired', 'Please sign in again to continue.', 'info');
                        return null;
                    });
                };
                window.addEventListener('lz-unauthorized', onUnauthorized);
                return () => window.removeEventListener('lz-unauthorized', onUnauthorized);
            }, []);

            // Re-run icons when components re-render
            useEffect(() => {
                if (window.lucide) {
                    window.lucide.createIcons();
                }
            });

            const handleLogout = async () => {
                try { await api('POST', '/auth/logout'); } catch (err) { /* cookie is cleared server-side when possible */ }
                setCurrentUser(null);
                setOrders([]);
                showAlert('Signed Out', 'You have been safely signed out from Lilizzh Studio.', 'info');
            };

            const handleRegistered = (user) => {
                setCurrentUser(user);
                setLoginModalOpen(false);
                showAlert('Account Created!', `Welcome to Lilizzh Studio, ${user.name}! Your workspace is ready.`, 'success');
            };

            if (!ready) {
                return (
                    <div className="min-h-screen bg-obsidian text-gray-400 flex items-center justify-center font-mono text-xs px-6 text-center">
                        {loadError || ''}
                    </div>
                );
            }
            return (
                <div className="min-h-screen bg-obsidian text-gray-100 flex flex-col font-sans relative">
                    {/* STUDIO HEADER */}
                    <header className="sticky top-0 z-40 glass-panel border-b border-white/10 px-4 md:px-8 py-3.5 flex items-center justify-between">
                        <div className="flex items-center space-x-3.5">
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-emerald-400 p-0.5 flex items-center justify-center glow-blue">
                                <div className="w-full h-full bg-obsidian rounded-[14px] flex items-center justify-center">
                                    <i data-lucide="video" className="w-5 h-5 text-blue-400"></i>
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center space-x-2">
                                    <span className="text-lg font-black tracking-tight bg-gradient-to-r from-white via-gray-200 to-blue-400 bg-clip-text text-transparent">
                                        LILIZZH STUDIO
                                    </span>
                                    <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-blue-500/20 text-blue-400 rounded-md border border-blue-500/30">v6.0</span>
                                </div>
                                <span className="block text-[10px] font-mono tracking-widest text-emerald-400 uppercase">Unified Multi-Editor Cloud Platform</span>
                            </div>
                        </div>

                        {/* Top Utility & External Links */}
                        <div className="flex items-center space-x-4 md:space-x-6">
                            <div className="hidden xl:flex items-center space-x-3 text-xs font-mono">
                                <a 
                                    href="https://lileshwar12.github.io/LilizZh-Freelancing/" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 flex items-center space-x-1.5 transition-all"
                                >
                                    <i data-lucide="external-link" className="w-3.5 h-3.5 text-blue-400"></i>
                                    <span>Sample Page</span>
                                </a>
                                <a 
                                    href="https://lileshwar12.github.io/lilizzh.studio" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="px-3 py-1.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center space-x-1.5 transition-all"
                                >
                                    <i data-lucide="sparkles" className="w-3.5 h-3.5 text-purple-400"></i>
                                    <span>Big Projects Studio</span>
                                </a>
                            </div>

                            <div className="hidden lg:flex items-center space-x-4 text-xs font-mono text-gray-400 border-l border-white/10 pl-4">
                                <ContactLinks onSignIn={() => setLoginModalOpen(true)} />
                            </div>

                            {currentUser ? (
                                <div className="flex items-center space-x-2.5 bg-black/60 p-1.5 rounded-2xl border border-white/10">
                                    <div className="px-3 py-1 rounded-xl bg-white/5 text-xs font-mono flex items-center space-x-2">
                                        <span className={`w-2 h-2 rounded-full ${
                                            currentUser.role === 'ADMIN' ? 'bg-emerald-400 animate-pulse' : 
                                            currentUser.role === 'EDITOR' ? 'bg-purple-400' : 'bg-blue-400'
                                        }`}></span>
                                        <span className="font-bold text-white max-w-[120px] truncate">{currentUser.name}</span>
                                        <span className="text-[10px] text-gray-400 font-mono hidden sm:inline">
                                            [{currentUser.role}]
                                        </span>
                                    </div>
                                    <button 
                                        onClick={handleLogout}
                                        className="p-2 sm:px-3 sm:py-1 rounded-xl bg-red-500/10 hover:bg-red-500/25 text-red-400 text-xs font-semibold transition-all border border-red-500/20 flex items-center space-x-1"
                                        title="Sign Out"
                                    >
                                        <i data-lucide="log-out" className="w-3.5 h-3.5"></i>
                                        <span className="hidden sm:inline">Logout</span>
                                    </button>
                                </div>
                            ) : (
                                <button 
                                    onClick={() => setLoginModalOpen(true)}
                                    className="px-5 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-500/30 flex items-center space-x-2"
                                >
                                    <i data-lucide="user-check" className="w-4 h-4"></i>
                                    <span>Portal Access</span>
                                </button>
                            )}
                        </div>
                    </header>

                    {/* DYNAMIC PORTAL ROUTING BASED ON USER ROLE */}
                    <main className="flex-1">
                        {!currentUser || currentUser.role === 'CLIENT' ? (
                            <ClientPortal 
                                orders={orders} 
                                onOrder={upsertOrder} 
                                showAlert={showAlert} 
                                currentUser={currentUser} 
                                openLoginModal={() => setLoginModalOpen(true)} 
                            />
                        ) : currentUser.role === 'EDITOR' ? (
                            <EditorWorkspace 
                                orders={orders} 
                                onOrder={upsertOrder} 
                                showAlert={showAlert} 
                                currentUser={currentUser} 
                            />
                        ) : (
                            <AdminDashboard 
                                orders={orders} 
                                onOrder={upsertOrder} 
                                showAlert={showAlert} 
                                currentUser={currentUser} 
                                onRosterChange={refreshRoster}
                                onConfigChange={refreshConfig}
                            />
                        )}
                    </main>

                    {/* UNIFIED AUTH MODAL */}
                    {loginModalOpen && (
                        <AuthModal 
                            isOpen={loginModalOpen} 
                            onClose={() => setLoginModalOpen(false)} 
                            onRegisterSuccess={handleRegistered}
                            onLoginSuccess={(user) => {
                                setCurrentUser(user);
                                setLoginModalOpen(false);
                                showAlert('Welcome Back!', `Logged in successfully as ${user.name} [${user.role} Portal]`, 'success');
                            }}
                            showAlert={showAlert}
                        />
                    )}

                    {/* STUDIO FOOTER */}
                    <footer className="glass-panel border-t border-white/10 py-10 px-6 text-xs text-gray-500">
                        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
                            <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold">
                                    L
                                </div>
                                <div>
                                    <span>&copy; 2026-2030. Permanent Cloud Storage Vault & Multi-Editor Hub.</span>
                                </div>
                            </div>
                            
                            <div className="flex flex-wrap items-center justify-center gap-6 text-gray-400 font-mono text-[11px]">
                                <a href="https://lileshwar12.github.io/LilizZh-Freelancing/" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">Sample Portfolio</a>
                                <a href="https://lileshwar12.github.io/lilizzh.studio" target="_blank" rel="noreferrer" className="hover:text-purple-400 transition-colors">Big Projects Studio</a>
                                <ContactLinks />
                            </div>
                        </div>
                    </footer>

                    {/* GLOBAL MODAL NOTIFIER */}
                    <CustomModal 
                        isOpen={modal.isOpen} 
                        title={modal.title} 
                        message={modal.message} 
                        type={modal.type} 
                        onClose={() => setModal({ ...modal, isOpen: false })} 
                    />
                </div>
            );
        }

        // AUTH MODAL WITH 3 ROLES: CLIENT, EDITOR, ADMIN
        function AuthModal({ isOpen, onClose, onRegisterSuccess, onLoginSuccess, showAlert }) {
            const [authMode, setAuthMode] = useState('client_login'); // client_login, client_signup, editor_login, admin_login
            const [clientLoginType, setClientLoginType] = useState('email'); // email or phone
            const [email, setEmail] = useState('');
            const [phone, setPhone] = useState('');
            const [password, setPassword] = useState('');
            const [name, setName] = useState('');
            const [selectedEditorId, setSelectedEditorId] = useState(EDITORS_LIST[0] ? EDITORS_LIST[0].id : 'ed-1');
            const [submitting, setSubmitting] = useState(false);

            if (!isOpen) return null;

            // Passwords are sent to the server over HTTPS and checked there. Nothing is compared in the browser.
            const handleSubmit = async (e) => {
                e.preventDefault();
                if (submitting) return;

                const failTitle = authMode === 'admin_login' ? 'Admin Login Failed'
                    : authMode === 'editor_login' ? 'Editor Sign-In Failed'
                    : authMode === 'client_signup' ? 'Sign Up Failed' : 'Sign In Failed';

                if (authMode === 'client_signup' && (!name.trim() || !email.trim() || !phone.trim() || !password)) {
                    showAlert('Input Required', 'Please complete all registration fields.', 'info');
                    return;
                }
                if (authMode === 'client_login' && !password) {
                    showAlert('Input Required', 'Please enter your password.', 'info');
                    return;
                }

                setSubmitting(true);
                try {
                    if (authMode === 'client_signup') {
                        const data = await api('POST', '/auth/register', {
                            name: name.trim(), email: email.trim(), phone: phone.trim(), password
                        });
                        onRegisterSuccess(data.user);
                        return;
                    }

                    let payload;
                    if (authMode === 'admin_login') {
                        payload = { role: 'ADMIN', email: email.trim(), password };
                    } else if (authMode === 'editor_login') {
                        payload = { role: 'EDITOR', editorId: selectedEditorId, password };
                    } else {
                        payload = { role: 'CLIENT', password,
                            ...(clientLoginType === 'email' ? { email: email.trim() } : { phone: phone.trim() }) };
                    }
                    const data = await api('POST', '/auth/login', payload);
                    onLoginSuccess(data.user);
                } catch (err) {
                    showAlert(failTitle, err.message, 'error');
                } finally {
                    setSubmitting(false);
                }
            };

            return (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
                    <div className="glass-panel max-w-md w-full p-8 rounded-3xl border border-white/10 space-y-6 glow-blue relative">
                        <button onClick={onClose} className="absolute top-6 right-6 text-gray-400 hover:text-white transition-colors">
                            <i data-lucide="x" className="w-5 h-5"></i>
                        </button>

                        <div className="text-center space-y-1.5">
                            <div className="inline-flex p-3 rounded-2xl bg-blue-500/10 text-blue-400 mb-1">
                                <i data-lucide={authMode === 'admin_login' ? 'shield-check' : authMode === 'editor_login' ? 'scissors' : 'user'} className="w-6 h-6"></i>
                            </div>
                            <h3 className="text-2xl font-bold text-white">
                                {authMode === 'admin_login' ? 'Studio Staff Admin' : 
                                 authMode === 'editor_login' ? 'Editor Portal' : 
                                 authMode === 'client_signup' ? 'Create Client Account' : 'Client Sign In'}
                            </h3>
                            <p className="text-xs text-gray-400">
                                {authMode === 'editor_login' ? 'Access your private queue, client folders & draft uploader' :
                                 authMode === 'admin_login' ? 'Financial verification, order dispatch & render release' :
                                 'Access your cloud media vault and production workspace'}
                            </p>
                        </div>

                        {/* Top Portal Switcher */}
                        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-black/50 border border-white/10 text-xs font-mono">
                            <button 
                                type="button"
                                onClick={() => { setAuthMode('client_login'); setPassword(''); }}
                                className={`py-2 rounded-xl transition-all ${authMode.startsWith('client') ? 'bg-blue-600 text-white font-bold shadow-md' : 'text-gray-400 hover:text-white'}`}
                            >
                                Client
                            </button>
                            <button 
                                type="button"
                                onClick={() => { setAuthMode('editor_login'); setPassword(''); }}
                                className={`py-2 rounded-xl transition-all ${authMode === 'editor_login' ? 'bg-purple-600 text-white font-bold shadow-md' : 'text-gray-400 hover:text-white'}`}
                            >
                                Editor
                            </button>
                            <button 
                                type="button"
                                onClick={() => { setAuthMode('admin_login'); setEmail(''); setPassword(''); }}
                                className={`py-2 rounded-xl transition-all ${authMode === 'admin_login' ? 'bg-emerald-600 text-white font-bold shadow-md' : 'text-gray-400 hover:text-white'}`}
                            >
                                Admin
                            </button>
                        </div>

                        {/* Client Login Options Tab */}
                        {authMode === 'client_login' && (
                            <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 text-[11px] font-mono">
                                <button
                                    type="button"
                                    onClick={() => setClientLoginType('email')}
                                    className={`flex-1 py-1.5 rounded-lg transition-all ${clientLoginType === 'email' ? 'bg-white/10 text-white font-bold' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Login via Email
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setClientLoginType('phone')}
                                    className={`flex-1 py-1.5 rounded-lg transition-all ${clientLoginType === 'phone' ? 'bg-white/10 text-white font-bold' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Login via Phone
                                </button>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4 font-sans text-xs">
                            {authMode === 'client_signup' && (
                                <>
                                    <div>
                                        <label className="text-[11px] font-mono text-gray-400 block mb-1">Full Name *</label>
                                        <input 
                                            type="text" 
                                            required
                                            placeholder="e.g. Alex Rivers"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-mono text-gray-400 block mb-1">WhatsApp / Contact Phone *</label>
                                        <input 
                                            type="tel" 
                                            required
                                            placeholder="+91 9876543210"
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-mono text-gray-400 block mb-1">Email Address *</label>
                                        <input 
                                            type="email" 
                                            required
                                            placeholder="alex@creator.io"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                                        />
                                    </div>
                                </>
                            )}

                            {authMode === 'client_login' && (
                                <>
                                    {clientLoginType === 'email' ? (
                                        <div>
                                            <label className="text-[11px] font-mono text-gray-400 block mb-1">Registered Email *</label>
                                            <input 
                                                type="email" 
                                                required
                                                placeholder="alex@creator.io"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                                            />
                                        </div>
                                    ) : (
                                        <div>
                                            <label className="text-[11px] font-mono text-gray-400 block mb-1">Registered Phone Number *</label>
                                            <input 
                                                type="tel" 
                                                required
                                                placeholder="+91 9876543210"
                                                value={phone}
                                                onChange={(e) => setPhone(e.target.value)}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                                            />
                                        </div>
                                    )}
                                </>
                            )}

                            {authMode === 'editor_login' && (
                                <div>
                                    <label className="text-[11px] font-mono text-gray-400 block mb-1">Select Editor Profile *</label>
                                    <select 
                                        value={selectedEditorId}
                                        onChange={(e) => {
                                            const id = e.target.value;
                                            setSelectedEditorId(id);
                                            setPassword('');
                                        }}
                                        className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                                    >
                                        {EDITORS_LIST.map(ed => (
                                            <option key={ed.id} value={ed.id}>{ed.name} — {ed.role}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {authMode === 'admin_login' && (
                                <div>
                                    <label className="text-[11px] font-mono text-gray-400 block mb-1">Admin Email Address *</label>
                                    <input 
                                        type="email" 
                                        required
                                        placeholder="Admin login email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 font-mono"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="text-[11px] font-mono text-gray-400 block mb-1">
                                    {authMode === 'editor_login' ? 'Editor Security Passcode *' : 'Password *'}
                                </label>
                                <input 
                                    type="password" 
                                    required
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <button 
                                type="submit"
                                className={`w-full py-3.5 rounded-2xl text-white font-bold text-xs transition-all shadow-lg flex items-center justify-center space-x-2 ${
                                    authMode === 'editor_login' ? 'bg-purple-600 hover:bg-purple-500 shadow-purple-500/30' :
                                    authMode === 'admin_login' ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/30' :
                                    'bg-blue-600 hover:bg-blue-500 shadow-blue-500/30'
                                }`}
                            >
                                <span>
                                    {authMode === 'client_signup' ? 'Create Account & Open Portal' :
                                     authMode === 'editor_login' ? 'Launch Editor Workspace' :
                                     authMode === 'admin_login' ? 'Enter Management Console' : 'Sign In to Workspace'}
                                </span>
                                <i data-lucide="arrow-right" className="w-4 h-4"></i>
                            </button>
                        </form>

                        {authMode.startsWith('client') && (
                            <div className="pt-3 border-t border-white/10 text-center">
                                <button 
                                    type="button"
                                    onClick={() => setAuthMode(authMode === 'client_login' ? 'client_signup' : 'client_login')}
                                    className="text-xs text-blue-400 hover:text-blue-300 font-mono transition-colors"
                                >
                                    {authMode === 'client_login' ? "New client? Create your secure account" : "Already registered? Sign in"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        // ==========================================
        // 1. CLIENT PORTAL COMPONENT
        // ==========================================
        function ClientPortal({ orders, onOrder, showAlert, currentUser, openLoginModal }) {
            const [activeTab, setActiveTab] = useState('explore'); // explore or workspace
            const [filterCategory, setFilterCategory] = useState('All');
            const [selectedEditor, setSelectedEditor] = useState(null);
            const [portfolioModalEditor, setPortfolioModalEditor] = useState(null);
            const [isBriefModalOpen, setIsBriefModalOpen] = useState(false);
            const [paymentModalOpen, setPaymentModalOpen] = useState(false);
            const [negotiateModalOpen, setNegotiateModalOpen] = useState(false);
            const [rateCardModalOpen, setRateCardModalOpen] = useState(false);
            const [utrNumber, setUtrNumber] = useState('');
            const [previewFile, setPreviewFile] = useState(null);

            // Workspace Folders & Files
            const [selectedFolder, setSelectedFolder] = useState('Raw Footage');
            const [newFolderName, setNewFolderName] = useState('');
            const [isCreatingFolder, setIsCreatingFolder] = useState(false);
            const [isUploading, setIsUploading] = useState(false);
            const [uploadProgress, setUploadProgress] = useState(0);
            const [newMessage, setNewMessage] = useState('');

            // Brief Data State
            const [briefData, setBriefData] = useState({
                projectType: 'Long video',
                aspectRatio: '16:9 Landscape',
                phone: currentUser?.phone || '',
                notes: '',
                budgetOffer: 160
            });

            // Negotiation form state
            const [negotiationInput, setNegotiationInput] = useState({
                proposedPrice: '',
                note: ''
            });

            const myOrders = currentUser ? orders.filter(o => o.clientEmail.toLowerCase() === currentUser.email.toLowerCase()) : orders;
            const [activeOrderId, setActiveOrderId] = useState(myOrders[0]?.id || '');

            useEffect(() => {
                if (myOrders.length > 0 && !myOrders.some(o => o.id === activeOrderId)) {
                    setActiveOrderId(myOrders[0].id);
                }
            }, [myOrders]);

            const currentOrder = myOrders.find(o => o.id === activeOrderId) || myOrders[0];
            const currentFolders = currentOrder?.folders || ['Raw Footage', 'Audio & Music', 'Graphics & B-Roll'];
            const currentFiles = (currentOrder?.uploadedFiles || []).filter(f => (f.folder || 'Raw Footage') === selectedFolder);

            // Keep default budget synchronized with selected project type
            const handleProjectTypeChange = (type) => {
                const matched = RATE_CARD.find(r => r.type === type);
                setBriefData({
                    ...briefData,
                    projectType: type,
                    budgetOffer: matched ? matched.clientPriceDefault : 160
                });
            };

            // 3D Canvas Hero Particle Field
            const canvasRef = useRef(null);
            useEffect(() => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const ctx = canvas.getContext('2d');
                let animationFrameId;
                let width = canvas.width = canvas.parentElement.offsetWidth;
                let height = canvas.height = canvas.parentElement.offsetHeight;

                const particles = Array.from({ length: 55 }, () => ({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    radius: Math.random() * 2 + 0.6,
                    vx: (Math.random() - 0.5) * 0.45,
                    vy: (Math.random() - 0.5) * 0.45,
                    alpha: Math.random() * 0.5 + 0.25
                }));

                let ringAngle = 0;

                const render = () => {
                    ctx.clearRect(0, 0, width, height);

                    particles.forEach(p => {
                        p.x += p.vx;
                        p.y += p.vy;
                        if (p.x < 0) p.x = width;
                        if (p.x > width) p.x = 0;
                        if (p.y < 0) p.y = height;
                        if (p.y > height) p.y = 0;

                        ctx.beginPath();
                        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                        ctx.fillStyle = `rgba(59, 130, 246, ${p.alpha})`;
                        ctx.fill();
                    });

                    // Orbital Gyro Ring
                    ctx.save();
                    ctx.translate(width / 2, height / 2);
                    ringAngle += 0.007;
                    ctx.rotate(ringAngle);

                    ctx.strokeStyle = 'rgba(59, 130, 246, 0.22)';
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.arc(0, 0, 150, 0, Math.PI * 2);
                    ctx.stroke();

                    ctx.strokeStyle = 'rgba(16, 185, 129, 0.18)';
                    ctx.beginPath();
                    ctx.arc(0, 0, 220, 0, Math.PI * 2);
                    ctx.stroke();

                    ctx.restore();

                    animationFrameId = requestAnimationFrame(render);
                };

                render();

                const handleResize = () => {
                    if (!canvas.parentElement) return;
                    width = canvas.width = canvas.parentElement.offsetWidth;
                    height = canvas.height = canvas.parentElement.offsetHeight;
                };
                window.addEventListener('resize', handleResize);
                return () => {
                    window.removeEventListener('resize', handleResize);
                    cancelAnimationFrame(animationFrameId);
                };
            }, []);

            const filteredEditors = filterCategory === 'All'
                ? EDITORS_LIST
                : EDITORS_LIST.filter(ed => ed.tag.toLowerCase() === filterCategory.toLowerCase());

            const handleHireClick = (editor, defaultType) => {
                if (!currentUser) {
                    openLoginModal();
                    return;
                }
                setSelectedEditor(editor);
                if (defaultType) {
                    handleProjectTypeChange(defaultType);
                }
                setIsBriefModalOpen(true);
            };

            const showMargins = RATE_CARD.some(r => r.editorPayoutRangeUSD);
            const failWith = (title) => (err) => showAlert(title, err.message, 'error');

            // Bank / UPI details are fetched from the server only when a signed-in client opens the payment window.
            const [paymentInfo, setPaymentInfo] = useState(null);
            const [paymentInfoError, setPaymentInfoError] = useState('');
            useEffect(() => {
                if (!paymentModalOpen || !currentOrder) return;
                let cancelled = false;
                setPaymentInfo(null);
                setPaymentInfoError('');
                api('GET', `/orders/${currentOrder.id}/payment-info`)
                    .then(info => { if (!cancelled) setPaymentInfo(info); })
                    .catch(err => { if (!cancelled) setPaymentInfoError(err.message); });
                return () => { cancelled = true; };
            }, [paymentModalOpen, currentOrder ? currentOrder.id : '']);

            const submitBrief = async (e) => {
                e.preventDefault();
                const matchedRate = RATE_CARD.find(r => r.type === briefData.projectType);
                try {
                    const { order } = await api('POST', '/orders', {
                        editorId: selectedEditor ? selectedEditor.id : null,
                        projectType: briefData.projectType,
                        aspectRatio: briefData.aspectRatio,
                        phone: briefData.phone || currentUser.phone || '',
                        notes: briefData.notes || 'Full standard edit with cinematic grading.',
                        budgetOffer: Number(briefData.budgetOffer) || (matchedRate ? matchedRate.clientPriceDefault : 160)
                    });
                    onOrder(order);
                    setActiveOrderId(order.id);
                    setIsBriefModalOpen(false);
                    setActiveTab('workspace');
                    showAlert('Project Initialized!', `Order ${order.id} initialized. Assigned to ${order.editor} with cloud vault unlocked.`, 'success');
                } catch (err) {
                    failWith('Could Not Create Project')(err);
                }
            };

            const handleNegotiationSubmit = async (e) => {
                e.preventDefault();
                if (!currentOrder || !negotiationInput.proposedPrice) return;
                const propPrice = Number(negotiationInput.proposedPrice);
                if (propPrice <= 0) {
                    showAlert('Invalid Amount', 'Please propose a positive price in USD.', 'error');
                    return;
                }
                try {
                    const { order } = await api('POST', `/orders/${currentOrder.id}/negotiation`, {
                        proposedPrice: propPrice, note: negotiationInput.note
                    });
                    onOrder(order);
                    setNegotiateModalOpen(false);
                    setNegotiationInput({ proposedPrice: '', note: '' });
                    showAlert('Offer Submitted!', `Your proposed price of $${propPrice} USD has been sent to Admin. You will receive an update shortly!`, 'success');
                } catch (err) {
                    failWith('Offer Not Sent')(err);
                }
            };

            const handleFileUpload = async (e) => {
                const input = e.target;
                const file = input.files[0];
                if (!file || !currentOrder) return;

                setIsUploading(true);
                setUploadProgress(0);
                try {
                    const { order } = await uploadFile(currentOrder.id, selectedFolder, file, setUploadProgress);
                    onOrder(order);
                    showAlert('Asset Vaulted!', `"${file.name}" permanently secured under directory [${selectedFolder}].`, 'success');
                } catch (err) {
                    failWith('Upload Failed')(err);
                } finally {
                    setIsUploading(false);
                    input.value = '';
                }
            };

            const handleDeleteFile = async (fileObj) => {
                if (!currentOrder) return;
                try {
                    const { order } = await api('DELETE', `/orders/${currentOrder.id}/files/${encodeURIComponent(fileObj.id)}`);
                    onOrder(order);
                    showAlert('File Removed', `File "${fileObj.name}" deleted from cloud vault.`, 'info');
                } catch (err) {
                    failWith('Could Not Delete File')(err);
                }
            };

            const handleCreateFolder = async (e) => {
                e.preventDefault();
                if (!newFolderName.trim() || !currentOrder) return;
                const name = newFolderName.trim();
                const existing = currentOrder.folders || ['Raw Footage'];

                if (existing.includes(name)) {
                    showAlert('Folder Exists', 'A folder with this name already exists.', 'info');
                    return;
                }
                try {
                    const { order } = await api('POST', `/orders/${currentOrder.id}/folders`, { name });
                    onOrder(order);
                    setSelectedFolder(name);
                    setNewFolderName('');
                    setIsCreatingFolder(false);
                    showAlert('Folder Created', `New vault directory "${name}" created.`, 'success');
                } catch (err) {
                    failWith('Could Not Create Folder')(err);
                }
            };

            const handleDeleteFolder = async (folderName) => {
                if (folderName === 'Raw Footage') {
                    showAlert('Protected Directory', 'The default "Raw Footage" directory cannot be deleted.', 'info');
                    return;
                }
                try {
                    const { order } = await api('DELETE', `/orders/${currentOrder.id}/folders?name=${encodeURIComponent(folderName)}`);
                    onOrder(order);
                    setSelectedFolder('Raw Footage');
                    showAlert('Directory Removed', `Folder "${folderName}" deleted. Associated files safely moved to Raw Footage.`, 'info');
                } catch (err) {
                    failWith('Could Not Delete Folder')(err);
                }
            };

            const handleDownloadFile = (fileObj) => {
                const a = document.createElement('a');
                a.href = fileObj.url;
                a.download = fileObj.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            };

            const handlePaymentProofSubmit = async (e) => {
                e.preventDefault();
                if (!utrNumber.trim() || !currentOrder) return;
                try {
                    const { order } = await api('POST', `/orders/${currentOrder.id}/payment-proof`, { utr: utrNumber.trim() });
                    onOrder(order);
                    setPaymentModalOpen(false);
                    setUtrNumber('');
                    showAlert('Payment Ref Registered!', 'UTR reference registered. Lead Staff will verify the bank transaction and unlock your clean 4K master.', 'success');
                } catch (err) {
                    failWith('Payment Reference Not Saved')(err);
                }
            };

            const [privateChat, setPrivateChat] = useState(false);
            const sendChatMessage = async (e) => {
                e.preventDefault();
                if (!newMessage.trim() || !currentOrder) return;
                const text = newMessage.trim();
                setNewMessage('');
                try {
                    const { order } = await api('POST', `/orders/${currentOrder.id}/messages`, { text, private: privateChat });
                    onOrder(order);
                } catch (err) {
                    setNewMessage(text);
                    failWith('Message Not Sent')(err);
                }
            };

            return (
                <div className="space-y-12 pb-20">
                    {/* Navigation Tab Bar */}
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-2 bg-black/50 p-1.5 rounded-2xl border border-white/10 self-start sm:self-auto">
                            <button 
                                onClick={() => setActiveTab('explore')}
                                className={`px-5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center space-x-2 ${
                                    activeTab === 'explore' ? 'bg-blue-600 text-white font-bold shadow-lg shadow-blue-500/25' : 'text-gray-400 hover:text-white'
                                }`}
                            >
                                <i data-lucide="compass" className="w-4 h-4"></i>
                                <span>Portfolio & Editors</span>
                            </button>
                            <button 
                                onClick={() => {
                                    if (!currentUser) openLoginModal();
                                    else setActiveTab('workspace');
                                }}
                                className={`px-5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center space-x-2 ${
                                    activeTab === 'workspace' ? 'bg-blue-600 text-white font-bold shadow-lg shadow-blue-500/25' : 'text-gray-400 hover:text-white'
                                }`}
                            >
                                <i data-lucide="hard-drive" className="w-4 h-4 text-emerald-400"></i>
                                <span>Cloud Workspace & Vault</span>
                                {myOrders.length > 0 && (
                                    <span className="px-2 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded-full font-mono font-bold">
                                        {myOrders.length}
                                    </span>
                                )}
                            </button>
                            
                        </div>

                        <div className="hidden md:flex items-center space-x-3 text-xs font-mono text-gray-400">
                            <span>Message the studio:</span>
                            <ContactLinks />
                        </div>
                    </div>

                    {activeTab === 'explore' ? (
                        <div className="space-y-20">
                            {/* HERO SECTION WITH CANVASES */}
                            <section className="relative min-h-[75vh] flex items-center justify-center overflow-hidden px-4 md:px-6">
                                <div className="absolute inset-0 z-0">
                                    <canvas ref={canvasRef} className="w-full h-full opacity-80"></canvas>
                                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-obsidian/80 to-obsidian"></div>
                                </div>

                                <div className="relative z-10 max-w-4xl mx-auto text-center space-y-6">
                                    <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-full glass-panel border border-blue-500/30 text-blue-400 text-xs font-mono uppercase tracking-widest glow-blue">
                                        <i data-lucide="sparkles" className="w-3.5 h-3.5"></i>
                                        <span>Lilizzh Studio v6.0 &bull; Multi-Editor Hub & Transparent Rate Card</span>
                                    </div>

                                    <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-tight">
                                        Turn Raw Footage Into <br />
                                        <span className="bg-gradient-to-r from-blue-400 via-emerald-400 to-purple-400 bg-clip-text text-transparent">
                                            High-Converting 4K Cinema
                                        </span>
                                    </h1>

                                    <p className="text-base sm:text-lg text-gray-300 max-w-2xl mx-auto leading-relaxed">
                                        Seamless client-to-editor pipelines with flexible pricing & negotiation: Short/Reels, 10x Batches, and Long Documentary Master cuts.
                                    </p>

                                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
                                        <button 
                                            onClick={() => {
                                                const el = document.getElementById('marketplace');
                                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                                            }}
                                            className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-xl shadow-blue-500/30 flex items-center justify-center space-x-3 group"
                                        >
                                            <span>Hire Dedicated Editor</span>
                                            <i data-lucide="arrow-right" className="w-4 h-4 group-hover:translate-x-1 transition-transform"></i>
                                        </button>

                                        <button 
                                            onClick={() => {
                                                const el = document.getElementById('rate-card-section');
                                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                                                else setRateCardModalOpen(true);
                                            }}
                                            className="w-full sm:w-auto px-8 py-4 rounded-2xl glass-panel hover:bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2"
                                        >
                                            <i data-lucide="receipt" className="w-4 h-4"></i>
                                            <span>View Rate Card & Margins</span>
                                        </button>
                                    </div>
                                </div>
                            </section>

                            {/* 1. CURATED EDITOR MARKETPLACE (CHOOSE YOUR DEDICATED EDITOR) */}
                            <section id="marketplace" className="max-w-7xl mx-auto px-4 md:px-6 space-y-10">
                                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/10 pb-6">
                                    <div>
                                        <span className="text-xs font-mono tracking-widest text-emerald-400 uppercase">Expert Roster</span>
                                        <h2 className="text-3xl font-extrabold text-white mt-1">Choose Your Dedicated Editor</h2>
                                        <p className="text-xs text-gray-400 mt-1">Every project is assigned to a dedicated professional with direct real-time communication.</p>
                                    </div>

                                    {/* Category Pills */}
                                    <div className="flex flex-wrap gap-2">
                                        {['All', 'YouTube', 'Shorts', 'Documentary', 'Ads'].map((cat) => (
                                            <button
                                                key={cat}
                                                onClick={() => setFilterCategory(cat)}
                                                className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                                                    filterCategory === cat 
                                                        ? 'bg-blue-600 text-white font-bold shadow-lg shadow-blue-500/25' 
                                                        : 'glass-panel text-gray-400 hover:text-white border border-white/10'
                                                }`}
                                            >
                                                {cat}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                    {filteredEditors.map((editor) => (
                                        <div key={editor.id} className="glass-card p-6 rounded-3xl flex flex-col justify-between space-y-6 relative overflow-hidden group">
                                            <div className="absolute top-4 right-4 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-mono font-bold">
                                                {editor.badge}
                                            </div>

                                            <div className="space-y-4">
                                                <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-white/10 group-hover:border-blue-500/50 transition-colors">
                                                    <img src={editor.avatar} alt={editor.name} className="w-full h-full object-cover" />
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-white">{editor.name}</h3>
                                                    <p className="text-xs text-gray-400 mt-0.5">{editor.role}</p>
                                                </div>
                                                <div className="flex items-center space-x-3 text-xs font-mono text-gray-400">
                                                    <span className="text-amber-400 font-bold flex items-center space-x-1">
                                                        <span>★</span>
                                                        <span>{editor.rating}</span>
                                                    </span>
                                                    <span>&bull;</span>
                                                    <span>Turnaround: <strong className="text-white">{editor.speed}</strong></span>
                                                </div>
                                            </div>

                                            <div className="space-y-2 pt-2">
                                                <button 
                                                    onClick={() => setPortfolioModalEditor(editor)}
                                                    className="w-full py-2.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-semibold text-xs transition-all border border-blue-500/20 flex items-center justify-center space-x-2"
                                                >
                                                    <i data-lucide="play-circle" className="w-4 h-4"></i>
                                                    <span>View Portfolio & Reel</span>
                                                </button>
                                                <button 
                                                    onClick={() => handleHireClick(editor)}
                                                    className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center space-x-2"
                                                >
                                                    <span>Hire {editor.name.split(' ')[0]}</span>
                                                    <i data-lucide="arrow-right" className="w-3.5 h-3.5"></i>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {/* 2. RATE CARD SHOWCASE BANNER (PLACED DIRECTLY AFTER CHOOSE YOUR EDITOR) */}
                            <section id="rate-card-section" className="max-w-7xl mx-auto px-4 md:px-6">
                                <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-white/10 glow-blue space-y-6">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div>
                                            <span className="text-xs font-mono text-emerald-400 uppercase tracking-widest font-bold">Standard Pricing & Negotiation</span>
                                            <h2 className="text-2xl md:text-3xl font-extrabold text-white mt-1">Video Editing Rate Card</h2>
                                            <p className="text-xs text-gray-400 mt-0.5">Transparent rates based on production scale. Clients can propose budget negotiations on any tier.</p>
                                        </div>
                                        <button 
                                            onClick={() => setRateCardModalOpen(true)}
                                            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-blue-400 border border-blue-500/30 self-start md:self-auto flex items-center space-x-1.5"
                                        >
                                            <i data-lucide="info" className="w-4 h-4"></i>
                                            <span>Detailed Breakdown</span>
                                        </button>
                                    </div>

                                    {/* 3 Tier Rate Cards */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                                        {RATE_CARD.map(rate => (
                                            <div key={rate.id} className="glass-card p-6 rounded-2xl border border-white/10 flex flex-col justify-between space-y-4">
                                                <div>
                                                    <span className="px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 font-mono text-[10px] font-bold uppercase">
                                                        {rate.typicalTurnaround}
                                                    </span>
                                                    <h3 className="text-lg font-bold text-white mt-3">{rate.type}</h3>
                                                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{rate.description}</p>
                                                </div>

                                                <div className="space-y-2 pt-2 border-t border-white/10">
                                                    <div className="flex justify-between items-baseline">
                                                        <span className="text-xs text-gray-400 font-mono">Client Standard:</span>
                                                        <span className="text-base font-bold text-emerald-400 font-mono">{rate.clientPriceRangeUSD}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-[11px] font-mono text-gray-400">
                                                        <span>INR Range:</span>
                                                        <span className="text-white font-semibold">{rate.clientPriceRangeINR}</span>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={() => handleHireClick(null, rate.type)}
                                                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-md flex items-center justify-center space-x-2"
                                                >
                                                    <span>Order {rate.type}</span>
                                                    <i data-lucide="arrow-right" className="w-3.5 h-3.5"></i>
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    {/* PRICING BUTTON & NEGOTIATION CTA BAR BELOW THE RATE CARD */}
                                    <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 bg-black/40 p-5 rounded-2xl border border-emerald-500/20">
                                        <div className="flex items-center space-x-3.5">
                                            <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-400">
                                                <i data-lucide="calculator" className="w-6 h-6"></i>
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold text-white">Custom Volume or Unique Requirements?</h4>
                                                <p className="text-xs text-gray-400">{showMargins ? 'Explore full profit splits, editor allocations, or propose your custom budget.' : 'Explore the full pricing matrix or propose your custom budget.'}</p>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                                            <button
                                                onClick={() => setRateCardModalOpen(true)}
                                                className="flex-1 sm:flex-none px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center space-x-2"
                                            >
                                                <i data-lucide="receipt" className="w-4 h-4"></i>
                                                <span>View Full Pricing Matrix</span>
                                            </button>
                                            <button
                                                onClick={() => handleHireClick(null, 'Long video')}
                                                className="flex-1 sm:flex-none px-6 py-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2"
                                            >
                                                <i data-lucide="scale" className="w-4 h-4"></i>
                                                <span>Negotiate Custom Budget</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* ABOUT THE FOUNDER & RESUME REQUEST SECTION */}
                            <section className="max-w-7xl mx-auto px-4 md:px-6 space-y-8">
                                <div className="glass-panel p-8 rounded-3xl border border-white/10 space-y-6">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div>
                                            <span className="text-xs font-mono text-blue-400 font-bold uppercase tracking-wider">Lead Technologist & Director</span>
                                            <h2 className="text-2xl md:text-3xl font-extrabold text-white mt-1">Lilesh Pravin Patil</h2>
                                            <p className="text-xs text-gray-400 mt-1">Creative Technologist building products at the intersection of software logic, AI automation, and cinematic video post-production.</p>
                                        </div>
                                        <div className="flex flex-wrap gap-3">
                                            <a 
                                                href="https://lileshwar12.github.io/LilizZh-Freelancing/" 
                                                target="_blank" 
                                                rel="noreferrer"
                                                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center space-x-2"
                                            >
                                                <span>Freelancing Case Studies</span>
                                                <i data-lucide="external-link" className="w-3.5 h-3.5"></i>
                                            </a>
                                            <a 
                                                href="https://lileshwar12.github.io/lilizzh.studio" 
                                                target="_blank" 
                                                rel="noreferrer"
                                                className="px-4 py-2 rounded-xl bg-purple-600/30 hover:bg-purple-600 text-purple-300 hover:text-white border border-purple-500/40 font-bold text-xs flex items-center space-x-2"
                                            >
                                                <span>Big Projects Agency</span>
                                                <i data-lucide="sparkles" className="w-3.5 h-3.5"></i>
                                            </a>
                                        </div>
                                    </div>

                                    {/* Direct Inquire & Resume Request Form */}
                                    <div className="pt-4 border-t border-white/10">
                                        <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider mb-3">Direct Inquire / Request Resume</h3>
                                        <form onSubmit={async (e) => {
                                            e.preventDefault();
                                            const form = e.target;
                                            const [nameInput, emailInput, phoneInput] = form.querySelectorAll('input');
                                            try {
                                                await api('POST', '/inquiries', {
                                                    name: nameInput.value, email: emailInput.value, phone: phoneInput.value
                                                });
                                                showAlert('Inquiry Dispatched!', 'Thank you! Your project inquiry has been forwarded to Lilesh Pravin Patil.', 'success');
                                                form.reset();
                                            } catch (err) {
                                                showAlert('Inquiry Not Sent', err.message, 'error');
                                            }
                                        }} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                            <input type="text" required placeholder="Your Name" className="bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" />
                                            <input type="email" required placeholder="Your Email" className="bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" />
                                            <input type="tel" placeholder="WhatsApp / Contact" className="bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" />
                                            <button type="submit" className="px-5 py-2.5 rounded-xl bg-white text-black font-bold text-xs hover:bg-gray-200 transition-colors">
                                                Send Inquiry
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            </section>
                        </div>
                    ) : (
                        /* ========================================================
                           CLIENT WORKSPACE & FILE VAULT WITH DUAL WATERMARK PLAYER
                           ======================================================== */
                        <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-8 animate-fadeIn">
                            {!currentOrder ? (
                                <div className="glass-panel p-12 rounded-3xl text-center space-y-6 border border-white/10">
                                    <div className="w-16 h-16 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto">
                                        <i data-lucide="folder-plus" className="w-8 h-8"></i>
                                    </div>
                                    <h3 className="text-2xl font-bold text-white">No Active Projects Yet</h3>
                                    <p className="text-gray-400 text-sm max-w-md mx-auto">Select a specialist editor from our curated roster to initialize your cloud storage vault.</p>
                                    <button 
                                        onClick={() => setActiveTab('explore')}
                                        className="px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-500/25"
                                    >
                                        Browse Editors
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {/* Project Header Card */}
                                    <div className="glass-panel p-6 rounded-3xl border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div>
                                            <div className="flex items-center space-x-3">
                                                <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider">
                                                    Cloud Storage Vault &bull; {currentOrder.id}
                                                </span>
                                                <span className="text-xs font-mono text-gray-400">Account: {currentUser?.email || currentOrder.clientEmail}</span>
                                            </div>
                                            <h2 className="text-2xl font-extrabold text-white mt-2">{currentOrder.projectType}</h2>
                                            <p className="text-xs text-gray-400 mt-1">Assigned Editor: <strong className="text-white">{currentOrder.editor}</strong> &bull; Agreed Budget: <strong className="text-emerald-400">${currentOrder.price} USD</strong></p>
                                        </div>

                                        <div className="flex items-center space-x-3">
                                            {myOrders.length > 1 && (
                                                <select 
                                                    value={activeOrderId} 
                                                    onChange={(e) => setActiveOrderId(e.target.value)}
                                                    className="bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                                                >
                                                    {myOrders.map(o => (
                                                        <option key={o.id} value={o.id}>{o.id} - {o.projectType}</option>
                                                    ))}
                                                </select>
                                            )}
                                            <span className={`px-4 py-2 rounded-xl text-xs font-bold font-mono ${
                                                currentOrder.unlocked 
                                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                            }`}>
                                                {currentOrder.unlocked ? '4K MASTER UNLOCKED' : 'WATERMARKED PREVIEW DRAFT'}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                        {/* Left 2 Cols: Video Player & Cloud File Vault */}
                                        <div className="lg:col-span-2 space-y-6">
                                            {/* Video Player Box with Unlocked Toggle */}
                                            <div className="glass-panel rounded-3xl overflow-hidden border border-white/10 relative shadow-2xl">
                                                <div className="relative aspect-video bg-black flex items-center justify-center">
                                                    <video 
                                                        controls 
                                                        playsInline
                                                        className="w-full h-full object-cover"
                                                        src={currentOrder.unlocked ? currentOrder.cleanUrl : currentOrder.draftUrl}
                                                    ></video>

                                                    {/* Overlaid repeating diagonal watermark if project is unpaid */}
                                                    {!currentOrder.unlocked && (
                                                        <div className="absolute inset-0 pointer-events-none watermark-overlay opacity-60 flex items-center justify-center">
                                                            <div className="px-6 py-2.5 rounded-2xl bg-red-600/90 text-white font-mono text-xs md:text-sm font-black tracking-widest shadow-2xl backdrop-blur-md border border-red-400/50 animate-pulse uppercase">
                                                                LILIZZH STUDIO — UNPAID DRAFT PREVIEW ONLY
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-black/50 border-t border-white/5">
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                                                            <span>Current Cut Status:</span>
                                                            <span className={currentOrder.unlocked ? "text-emerald-400" : "text-amber-400"}>
                                                                {currentOrder.unlocked ? "Clean 4K Export Ready" : "Draft Preview Mode"}
                                                            </span>
                                                        </h4>
                                                        <p className="text-xs text-gray-400 mt-0.5">
                                                            {currentOrder.unlocked 
                                                                ? "Payment verified. You can now download the raw clean ProRes/MP4 4K master file."
                                                                : `Pay current fee of $${currentOrder.price} USD (₹${currentOrder.price * 86} INR) or propose a custom rate.`}
                                                        </p>
                                                    </div>

                                                    <div className="flex flex-wrap sm:flex-nowrap gap-2 shrink-0 w-full sm:w-auto">
                                                        {!currentOrder.unlocked && (
                                                            <button 
                                                                onClick={() => {
                                                                    setNegotiationInput({
                                                                        proposedPrice: currentOrder.price,
                                                                        note: ''
                                                                    });
                                                                    setNegotiateModalOpen(true);
                                                                }}
                                                                className="flex-1 sm:flex-none px-4 py-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 font-bold text-xs transition-all flex items-center justify-center space-x-1.5"
                                                            >
                                                                <i data-lucide="scale" className="w-4 h-4"></i>
                                                                <span>Negotiate Price</span>
                                                            </button>
                                                        )}

                                                        {!currentOrder.unlocked ? (
                                                            <button 
                                                                onClick={() => setPaymentModalOpen(true)}
                                                                className="flex-1 sm:flex-none px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center space-x-2"
                                                            >
                                                                <i data-lucide="qr-code" className="w-4 h-4"></i>
                                                                <span>Pay ${currentOrder.price} & Unlock 4K</span>
                                                            </button>
                                                        ) : (
                                                            <a 
                                                                href={currentOrder.cleanUrl} 
                                                                download={`${currentOrder.id}_Clean_4K_Master.mp4`}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center space-x-2 shrink-0"
                                                            >
                                                                <i data-lucide="download" className="w-4 h-4"></i>
                                                                <span>Download 4K Clean Master (.mp4)</span>
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Negotiation Status Banner if active */}
                                            {currentOrder.negotiation && (
                                                <div className="glass-panel p-4 rounded-2xl border border-purple-500/30 bg-purple-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
                                                    <div className="space-y-1">
                                                        <div className="flex items-center space-x-2 text-purple-300 font-bold">
                                                            <i data-lucide="scale" className="w-4 h-4"></i>
                                                            <span>Negotiation In Progress</span>
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/20 border border-purple-500/40">
                                                                {currentOrder.negotiation.status}
                                                            </span>
                                                        </div>
                                                        <p className="text-gray-300">
                                                            Proposed: <strong className="text-white">${currentOrder.negotiation.proposedPrice} USD (₹{currentOrder.negotiation.proposedPrice * 86} INR)</strong> &bull; Note: "{currentOrder.negotiation.clientNote}"
                                                        </p>
                                                    </div>
                                                    <span className="text-gray-400 text-[11px] shrink-0">Awaiting Admin Response</span>
                                                </div>
                                            )}

                                            {/* PERMANENT CLOUD STORAGE & FOLDER MANAGER */}
                                            <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-6">
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
                                                    <div>
                                                        <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                                                            <i data-lucide="hard-drive" className="w-5 h-5 text-blue-400"></i>
                                                            <span>Cloud Storage Vault</span>
                                                        </h3>
                                                        <p className="text-xs text-gray-400 mt-0.5">Upload raw footage, audio, and color assets into permanent folders.</p>
                                                    </div>

                                                    <button 
                                                        onClick={() => setIsCreatingFolder(true)}
                                                        className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono font-bold text-blue-400 border border-blue-500/30 flex items-center space-x-1.5 self-start sm:self-auto transition-all"
                                                    >
                                                        <i data-lucide="folder-plus" className="w-4 h-4"></i>
                                                        <span>New Folder</span>
                                                    </button>
                                                </div>

                                                {/* New Folder Creation Bar */}
                                                {isCreatingFolder && (
                                                    <form onSubmit={handleCreateFolder} className="flex items-center space-x-2 bg-black/50 p-3 rounded-2xl border border-blue-500/40 animate-fadeIn">
                                                        <i data-lucide="folder" className="w-4 h-4 text-blue-400"></i>
                                                        <input 
                                                            type="text" 
                                                            required
                                                            placeholder="Folder Name (e.g. Color LUTs, Voiceovers, Drone Shots)..."
                                                            value={newFolderName}
                                                            onChange={(e) => setNewFolderName(e.target.value)}
                                                            className="flex-1 bg-transparent text-xs text-white focus:outline-none font-mono"
                                                        />
                                                        <button type="submit" className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold">Add</button>
                                                        <button type="button" onClick={() => setIsCreatingFolder(false)} className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-400 text-xs">Cancel</button>
                                                    </form>
                                                )}

                                                {/* Directory Tabs */}
                                                <div className="flex items-center space-x-2 overflow-x-auto pb-2">
                                                    {currentFolders.map(folder => (
                                                        <div key={folder} className="flex items-center group">
                                                            <button 
                                                                onClick={() => setSelectedFolder(folder)}
                                                                className={`px-4 py-2 rounded-xl text-xs font-mono font-semibold transition-all flex items-center space-x-2 whitespace-nowrap ${
                                                                    selectedFolder === folder 
                                                                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
                                                                        : 'bg-white/5 text-gray-400 hover:text-white border border-white/5'
                                                                }`}
                                                            >
                                                                <i data-lucide="folder" className="w-3.5 h-3.5"></i>
                                                                <span>{folder}</span>
                                                                <span className="px-1.5 py-0.5 rounded-full bg-black/50 text-[10px]">
                                                                    {(currentOrder.uploadedFiles || []).filter(f => (f.folder || 'Raw Footage') === folder).length}
                                                                </span>
                                                            </button>
                                                            {folder !== 'Raw Footage' && (
                                                                <button 
                                                                    onClick={() => handleDeleteFolder(folder)}
                                                                    title="Delete Folder"
                                                                    className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                                                                >
                                                                    <i data-lucide="trash-2" className="w-3.5 h-3.5"></i>
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Drag & Drop Upload Zone */}
                                                <label className="border-2 border-dashed border-white/15 hover:border-blue-500/50 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all bg-white/[0.01]">
                                                    <i data-lucide="upload-cloud" className="w-8 h-8 text-blue-400 mb-2 animate-bounce"></i>
                                                    <span className="text-xs font-semibold text-white">Click or Drop files to upload into [{selectedFolder}]</span>
                                                    <span className="text-[10px] text-gray-400 mt-1 font-mono">Supported: MP4, MOV, WAV, PNG, LUT, ZIP, ProRes</span>
                                                    <input type="file" className="hidden" onChange={handleFileUpload} />
                                                </label>

                                                {/* Upload Progress Bar */}
                                                {isUploading && (
                                                    <div className="space-y-2 bg-black/40 p-4 rounded-xl border border-white/10">
                                                        <div className="flex justify-between text-xs font-mono">
                                                            <span className="text-blue-400">Securing file to cloud storage...</span>
                                                            <span className="text-white font-bold">{uploadProgress}%</span>
                                                        </div>
                                                        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                                                            <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${uploadProgress}%` }}></div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Files List in Current Folder */}
                                                <div className="space-y-3 pt-2">
                                                    <h4 className="text-xs font-mono text-gray-400 uppercase">Files in [{selectedFolder}] ({currentFiles.length})</h4>
                                                    {currentFiles.length === 0 ? (
                                                        <div className="text-center py-8 text-gray-500 text-xs italic bg-white/[0.01] rounded-2xl border border-white/5">
                                                            No files uploaded in this directory yet. Upload raw takes above.
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {currentFiles.map(file => (
                                                                <div key={file.id} className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/10 hover:border-blue-500/30 transition-all text-xs font-mono">
                                                                    <div className="flex items-center space-x-3 overflow-hidden">
                                                                        <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 shrink-0">
                                                                            <i data-lucide="file-video" className="w-4 h-4"></i>
                                                                        </div>
                                                                        <div className="truncate">
                                                                            <p className="font-bold text-white truncate font-sans">{file.name}</p>
                                                                            <p className="text-[10px] text-gray-400">{file.size} &bull; Uploaded {file.date}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center space-x-2 shrink-0">
                                                                        <button 
                                                                            onClick={() => setPreviewFile(file)}
                                                                            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[11px] flex items-center space-x-1"
                                                                        >
                                                                            <i data-lucide="eye" className="w-3.5 h-3.5"></i>
                                                                            <span>Preview</span>
                                                                        </button>
                                                                        <button 
                                                                            onClick={() => handleDownloadFile(file)}
                                                                            className="px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white text-[11px] flex items-center space-x-1"
                                                                        >
                                                                            <i data-lucide="download" className="w-3.5 h-3.5"></i>
                                                                            <span>Download</span>
                                                                        </button>
                                                                        <button 
                                                                            onClick={() => handleDeleteFile(file)}
                                                                            className="p-1.5 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white transition-all"
                                                                            title="Delete File"
                                                                        >
                                                                            <i data-lucide="trash-2" className="w-3.5 h-3.5"></i>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Right Col: Live Chat & Order Specs */}
                                        <div className="space-y-6">
                                            {/* Studio Project Chat */}
                                            <div className="glass-panel p-6 rounded-3xl border border-white/10 flex flex-col h-[520px]">
                                                <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
                                                    <div>
                                                        <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                                                            <i data-lucide="message-square" className="w-4 h-4 text-emerald-400"></i>
                                                            <span>Editor Project Chat</span>
                                                        </h3>
                                                        <span className="text-[10px] text-gray-400 font-mono">Assigned Editor: <strong className="text-purple-400">{currentOrder.editor}</strong></span>
                                                    </div>
                                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                                </div>

                                                <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
                                                    {(currentOrder.chatMessages || []).map((msg, idx) => (
                                                        <div key={idx} className={`flex flex-col ${msg.sender === 'client' ? 'items-end' : 'items-start'}`}>
                                                            <div className={`max-w-[85%] p-3 rounded-2xl leading-relaxed ${
                                                                msg.sender === 'client' 
                                                                    ? 'bg-blue-600 text-white rounded-br-none' 
                                                                    : msg.sender === 'system'
                                                                    ? 'bg-white/5 border border-white/10 text-gray-300 w-full text-center font-mono text-[11px]'
                                                                    : 'bg-purple-900/40 text-purple-200 border border-purple-500/30 rounded-bl-none'
                                                            }`}>
                                                                {msg.private && msg.sender !== 'system' && <i data-lucide="lock" className="w-3 h-3 inline mr-1 opacity-70"></i>}
                                                                {msg.text}
                                                            </div>
                                                            <span className="text-[9px] text-gray-500 font-mono mt-1">{msg.private ? 'Private - studio owner only · ' : ''}{msg.time}</span>
                                                        </div>
                                                    ))}
                                                </div>

                                                <label className="mt-3 flex items-center space-x-2 text-[11px] font-mono text-gray-400 cursor-pointer select-none">
                                                    <input type="checkbox" checked={privateChat} onChange={(e) => setPrivateChat(e.target.checked)} />
                                                    <span>Private message to the studio owner only (your editor will not see it)</span>
                                                </label>
                                                <form onSubmit={sendChatMessage} className="mt-2 pt-3 border-t border-white/10 flex items-center space-x-2">
                                                    <input 
                                                        type="text" 
                                                        placeholder={privateChat ? 'Private note to the studio owner...' : 'Type note to editor...'}
                                                        value={newMessage}
                                                        onChange={(e) => setNewMessage(e.target.value)}
                                                        className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 font-sans"
                                                    />
                                                    <button type="submit" className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white">
                                                        <i data-lucide="send" className="w-4 h-4"></i>
                                                    </button>
                                                </form>
                                            </div>

                                            {/* Project Specs Card */}
                                            <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider">Project Specifications</h3>
                                                    <button 
                                                        onClick={() => setRateCardModalOpen(true)}
                                                        className="text-[11px] text-blue-400 hover:underline font-mono"
                                                    >
                                                        Rate Card
                                                    </button>
                                                </div>
                                                <div className="space-y-2.5 text-xs font-mono text-gray-300">
                                                    <div className="flex justify-between py-1 border-b border-white/5">
                                                        <span className="text-gray-500">Project ID:</span>
                                                        <span className="text-blue-400 font-bold">{currentOrder.id}</span>
                                                    </div>
                                                    <div className="flex justify-between py-1 border-b border-white/5">
                                                        <span className="text-gray-500">Tier / Format:</span>
                                                        <span className="text-white font-bold">{currentOrder.projectType}</span>
                                                    </div>
                                                    <div className="flex justify-between py-1 border-b border-white/5">
                                                        <span className="text-gray-500">Editor:</span>
                                                        <span className="text-purple-300">{currentOrder.editor}</span>
                                                    </div>
                                                    <div className="flex justify-between py-1 border-b border-white/5">
                                                        <span className="text-gray-500">Status:</span>
                                                        <span className="text-emerald-400 font-bold">{currentOrder.status}</span>
                                                    </div>
                                                    <div className="flex justify-between py-1">
                                                        <span className="text-gray-500">Agreed Price:</span>
                                                        <span className="text-emerald-400 font-bold text-sm">
                                                            ${currentOrder.price} USD / ₹{currentOrder.price * 86} INR
                                                        </span>
                                                    </div>
                                                </div>

                                                {!currentOrder.unlocked && (
                                                    <button
                                                        onClick={() => {
                                                            setNegotiationInput({
                                                                proposedPrice: currentOrder.price,
                                                                note: ''
                                                            });
                                                            setNegotiateModalOpen(true);
                                                        }}
                                                        className="w-full py-2.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 font-mono text-xs border border-purple-500/30 flex items-center justify-center space-x-2 transition-all"
                                                    >
                                                        <i data-lucide="scale" className="w-3.5 h-3.5"></i>
                                                        <span>Propose Counter-Offer</span>
                                                    </button>
                                                )}

                                                {/* UTR Status if client submitted */}
                                                {currentOrder.paymentProof && (
                                                    <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-mono space-y-1">
                                                        <div className="flex items-center space-x-1.5 text-emerald-400 font-bold">
                                                            <i data-lucide="check-circle" className="w-3.5 h-3.5"></i>
                                                            <span>UTR Registered</span>
                                                        </div>
                                                        <p className="text-gray-300">Ref: <strong>{currentOrder.paymentProof.utr}</strong></p>
                                                        <p className="text-[10px] text-gray-400">Status: {currentOrder.paymentProof.status}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* BRIEF MODAL */}
                    {isBriefModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
                            <div className="glass-panel max-w-lg w-full p-8 rounded-3xl border border-white/10 space-y-6 glow-blue relative max-h-[90vh] overflow-y-auto">
                                <button onClick={() => setIsBriefModalOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-white">
                                    <i data-lucide="x" className="w-5 h-5"></i>
                                </button>

                                <div className="space-y-1">
                                    <h3 className="text-2xl font-bold text-white">Project Initialization Brief</h3>
                                    <p className="text-xs text-gray-400">
                                        Assigning project to <strong className="text-blue-400">{selectedEditor?.name || 'Lead Specialist'}</strong>
                                    </p>
                                </div>

                                <form onSubmit={submitBrief} className="space-y-4 font-sans text-xs">
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-[11px] font-mono text-gray-400">Project Category & Rate Tier *</label>
                                            <button 
                                                type="button" 
                                                onClick={() => setRateCardModalOpen(true)}
                                                className="text-[10px] font-mono text-emerald-400 hover:underline"
                                            >
                                                Rate Card Guide
                                            </button>
                                        </div>
                                        <select 
                                            value={briefData.projectType}
                                            onChange={(e) => handleProjectTypeChange(e.target.value)}
                                            className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
                                        >
                                            <option value="Short / Reel">Short / Reel ($25 - $35 / ₹2,000 - ₹2,900)</option>
                                            <option value="Batch of 10 Short / Reel">Batch of 10 Short / Reel ($250 - $300 / ₹21,000 - ₹25,000)</option>
                                            <option value="Long video">Long video ($120 - $200 / ₹10,000 - ₹16,000)</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-mono text-gray-400 block mb-1">Starting Budget Offer ($ USD) *</label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-3 text-gray-500 font-mono">$</span>
                                            <input 
                                                type="number"
                                                required
                                                min="10"
                                                value={briefData.budgetOffer}
                                                onChange={(e) => setBriefData({ ...briefData, budgetOffer: e.target.value })}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-white font-mono focus:outline-none focus:border-blue-500"
                                            />
                                        </div>
                                        <span className="text-[10px] text-gray-400 font-mono mt-1 block">
                                            Approx. ₹{(Number(briefData.budgetOffer) || 0) * 86} INR. You can also negotiate further with Admin after brief creation.
                                        </span>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-mono text-gray-400 block mb-1">Target Aspect Ratio *</label>
                                        <select 
                                            value={briefData.aspectRatio}
                                            onChange={(e) => setBriefData({...briefData, aspectRatio: e.target.value})}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                                        >
                                            <option value="16:9 Landscape">16:9 Landscape (YouTube, TV, Cinema)</option>
                                            <option value="9:16 Vertical">9:16 Vertical (TikTok, Instagram Reels, Shorts)</option>
                                            <option value="1:1 Square">1:1 Square (Instagram Feed, LinkedIn)</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-mono text-gray-400 block mb-1">Contact Phone Number (WhatsApp updates) *</label>
                                        <input 
                                            type="tel" 
                                            required
                                            placeholder="+91 9876543210"
                                            value={briefData.phone}
                                            onChange={(e) => setBriefData({...briefData, phone: e.target.value})}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-mono text-gray-400 block mb-1">Creative Directives & References *</label>
                                        <textarea 
                                            rows="3"
                                            required
                                            placeholder="Specify color grading preference, pacing, sound effects style, or paste reference links..."
                                            value={briefData.notes}
                                            onChange={(e) => setBriefData({...briefData, notes: e.target.value})}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-blue-500 resize-none font-sans"
                                        ></textarea>
                                    </div>

                                    <button 
                                        type="submit"
                                        className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-xl shadow-blue-500/25 flex items-center justify-center space-x-2"
                                    >
                                        <span>Initialize Project & Open Cloud Vault</span>
                                        <i data-lucide="arrow-right" className="w-4 h-4"></i>
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                    {/* NEGOTIATE MODAL */}
                    {negotiateModalOpen && currentOrder && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
                            <div className="glass-panel max-w-md w-full p-8 rounded-3xl border border-purple-500/30 space-y-6 glow-purple relative">
                                <button onClick={() => setNegotiateModalOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-white">
                                    <i data-lucide="x" className="w-5 h-5"></i>
                                </button>

                                <div className="space-y-1.5 text-center">
                                    <div className="inline-flex p-3 rounded-2xl bg-purple-500/10 text-purple-400 mb-1">
                                        <i data-lucide="scale" className="w-6 h-6"></i>
                                    </div>
                                    <h3 className="text-2xl font-bold text-white">Negotiate Project Price</h3>
                                    <p className="text-xs text-gray-400">
                                        Order: <strong className="text-white">{currentOrder.id}</strong> ({currentOrder.projectType})
                                    </p>
                                </div>

                                <div className="p-3.5 rounded-2xl bg-white/5 border border-white/5 text-xs font-mono space-y-1">
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Current Agreed Price:</span>
                                        <span className="text-white font-bold">${currentOrder.price} USD (₹{currentOrder.price * 86})</span>
                                    </div>
                                    <div className="flex justify-between text-[11px] text-gray-400">
                                        <span>Standard Rate Range:</span>
                                        <span className="text-emerald-400">
                                            {RATE_CARD.find(r => r.type === currentOrder.projectType)?.clientPriceRangeUSD || '$25 - $200'}
                                        </span>
                                    </div>
                                </div>

                                <form onSubmit={handleNegotiationSubmit} className="space-y-4 text-xs font-sans">
                                    <div>
                                        <label className="text-[11px] font-mono text-gray-300 block mb-1">Your Proposed Budget ($ USD) *</label>
                                        <div className="relative">
                                            <span className="absolute left-4 top-3 text-gray-500 font-mono">$</span>
                                            <input 
                                                type="number" 
                                                required
                                                min="10"
                                                placeholder="e.g. 140"
                                                value={negotiationInput.proposedPrice}
                                                onChange={(e) => setNegotiationInput({ ...negotiationInput, proposedPrice: e.target.value })}
                                                className="w-full bg-black/60 border border-white/15 rounded-xl pl-8 pr-4 py-3 text-white font-mono focus:outline-none focus:border-purple-500"
                                            />
                                        </div>
                                        <span className="text-[10px] text-gray-400 font-mono mt-1 block">
                                            Equivalent to ₹{(Number(negotiationInput.proposedPrice) || 0) * 86} INR
                                        </span>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-mono text-gray-300 block mb-1">Reason / Scope Notes</label>
                                        <textarea 
                                            rows="3"
                                            placeholder="Explain package volume, simpler cut requirements, or long-term engagement..."
                                            value={negotiationInput.note}
                                            onChange={(e) => setNegotiationInput({ ...negotiationInput, note: e.target.value })}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3.5 text-white focus:outline-none focus:border-purple-500 resize-none font-sans"
                                        ></textarea>
                                    </div>

                                    <button 
                                        type="submit"
                                        className="w-full py-3.5 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-purple-500/25 flex items-center justify-center space-x-2"
                                    >
                                        <i data-lucide="send" className="w-4 h-4"></i>
                                        <span>Submit Counter-Offer to Admin</span>
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                    {/* RATE CARD MODAL */}
                    {rateCardModalOpen && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
                            <div className="glass-panel max-w-3xl w-full p-8 rounded-3xl border border-white/10 space-y-6 glow-emerald max-h-[90vh] overflow-y-auto relative">
                                <button onClick={() => setRateCardModalOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-white">
                                    <i data-lucide="x" className="w-5 h-5"></i>
                                </button>

                                <div>
                                    <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider">
                                        Lilizzh Studio Standard Pricing Guide
                                    </span>
                                    <h3 className="text-2xl font-bold text-white mt-2">Video Editing Rate Card</h3>
                                    <p className="text-xs text-gray-400">{showMargins ? 'Complete breakdown of client ranges, editor allocations, and agency margins.' : 'Complete breakdown of client price ranges and typical turnaround times.'}</p>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs font-mono">
                                        <thead>
                                            <tr className="border-b border-white/15 text-gray-400">
                                                <th className="py-3 px-2">Project Type</th>
                                                <th className="py-3 px-2 text-emerald-400">Client Price</th>
                                                {showMargins && <th className="py-3 px-2 text-purple-300">Editor Payout</th>}
                                                {showMargins && <th className="py-3 px-2 text-blue-400">Studio Profit</th>}
                                                <th className="py-3 px-2">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/10">
                                            {RATE_CARD.map(row => (
                                                <tr key={row.id} className="hover:bg-white/[0.02]">
                                                    <td className="py-4 px-2">
                                                        <strong className="text-white block font-sans text-sm">{row.type}</strong>
                                                        <span className="text-[10px] text-gray-400 font-sans">{row.description}</span>
                                                    </td>
                                                    <td className="py-4 px-2">
                                                        <span className="text-emerald-400 font-bold block">{row.clientPriceRangeUSD}</span>
                                                        <span className="text-[10px] text-gray-400 font-sans">{row.clientPriceRangeINR}</span>
                                                    </td>
                                                    {showMargins && (
                                                    <td className="py-4 px-2">
                                                        <span className="text-purple-300 font-bold block">{row.editorPayoutRangeUSD}</span>
                                                        <span className="text-[10px] text-gray-400 font-sans">{row.editorPayoutRangeINR}</span>
                                                    </td>
                                                    )}
                                                    {showMargins && (
                                                    <td className="py-4 px-2">
                                                        <span className="text-blue-400 font-bold block">{row.profitRangeUSD}</span>
                                                        <span className="text-[10px] text-gray-400 font-sans">{row.profitRangeINR}</span>
                                                    </td>
                                                    )}
                                                    <td className="py-4 px-2">
                                                        <button 
                                                            onClick={() => {
                                                                setRateCardModalOpen(false);
                                                                handleHireClick(null, row.type);
                                                            }}
                                                            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] whitespace-nowrap"
                                                        >
                                                            Select
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                                    <div className="flex items-center space-x-2 text-gray-300">
                                        <i data-lucide="scale" className="w-4 h-4 text-purple-400 shrink-0"></i>
                                        <span>Have custom volume or long-term project requirements? Negotiation is available on all contracts.</span>
                                    </div>
                                    <button 
                                        onClick={() => setRateCardModalOpen(false)}
                                        className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-mono text-xs self-start sm:self-auto"
                                    >
                                        Close Guide
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* PORTFOLIO SHOWCASE MODAL */}
                    {portfolioModalEditor && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
                            <div className="glass-panel max-w-2xl w-full p-8 rounded-3xl border border-white/10 space-y-6 glow-blue max-h-[90vh] overflow-y-auto relative">
                                <button 
                                    onClick={() => setPortfolioModalEditor(null)} 
                                    className="absolute top-6 right-6 text-gray-400 hover:text-white"
                                >
                                    <i data-lucide="x" className="w-5 h-5"></i>
                                </button>

                                <div className="flex items-center space-x-4">
                                    <img src={portfolioModalEditor.avatar} alt={portfolioModalEditor.name} className="w-16 h-16 rounded-2xl object-cover border-2 border-blue-500/40" />
                                    <div>
                                        <h3 className="text-2xl font-bold text-white">{portfolioModalEditor.name}</h3>
                                        <p className="text-xs text-blue-400 font-mono mt-0.5">{portfolioModalEditor.role} &bull; Rating {portfolioModalEditor.rating} ★</p>
                                    </div>
                                </div>

                                <p className="text-xs text-gray-300 leading-relaxed bg-white/5 p-4 rounded-2xl border border-white/5 font-sans">
                                    {portfolioModalEditor.bio}
                                </p>

                                <div className="space-y-4">
                                    <h4 className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">Sample Video Portfolio</h4>
                                    {portfolioModalEditor.portfolioVideos.map((vid, idx) => (
                                        <div key={idx} className="space-y-2">
                                            <span className="text-xs font-bold text-white block">{vid.title}</span>
                                            <div className="aspect-video bg-black rounded-2xl overflow-hidden border border-white/10">
                                                <video controls playsInline className="w-full h-full object-cover" src={vid.url}></video>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="pt-4 border-t border-white/10 flex justify-end space-x-3">
                                    <button 
                                        onClick={() => setPortfolioModalEditor(null)}
                                        className="px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-gray-300"
                                    >
                                        Close
                                    </button>
                                    <button 
                                        onClick={() => {
                                            const ed = portfolioModalEditor;
                                            setPortfolioModalEditor(null);
                                            handleHireClick(ed);
                                        }}
                                        className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-500/25 flex items-center space-x-2"
                                    >
                                        <span>Hire {portfolioModalEditor.name.split(' ')[0]} Now</span>
                                        <i data-lucide="arrow-right" className="w-4 h-4"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* FILE PREVIEW MODAL */}
                    {previewFile && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
                            <div className="glass-panel max-w-2xl w-full p-6 rounded-3xl border border-white/10 space-y-4 glow-blue">
                                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                                    <div className="flex items-center space-x-2 truncate">
                                        <i data-lucide="eye" className="w-5 h-5 text-blue-400 shrink-0"></i>
                                        <h3 className="text-sm font-bold text-white font-mono truncate">{previewFile.name}</h3>
                                    </div>
                                    <button onClick={() => setPreviewFile(null)} className="text-gray-400 hover:text-white">
                                        <i data-lucide="x" className="w-5 h-5"></i>
                                    </button>
                                </div>

                                <div className="aspect-video bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/5">
                                    {previewFile.name.match(/\.(mp4|webm|mov)$/i) ? (
                                        <video controls playsInline className="w-full h-full object-contain" src={previewFile.url + '?inline=1'}></video>
                                    ) : previewFile.name.match(/\.(png|jpg|jpeg|webp)$/i) ? (
                                        <img src={previewFile.url + '?inline=1'} alt={previewFile.name} className="max-h-full object-contain" />
                                    ) : (
                                        <div className="text-center p-6 font-mono text-xs text-gray-400">
                                            <i data-lucide="file-text" className="w-12 h-12 mx-auto mb-2 text-blue-400"></i>
                                            <span>Format: Binary / LUT / Archive</span>
                                            <span className="block mt-1 text-gray-500">{previewFile.size}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="flex justify-between items-center text-xs font-mono text-gray-400 pt-2">
                                    <span>Folder: {previewFile.folder || 'Raw Footage'}</span>
                                    <button 
                                        onClick={() => handleDownloadFile(previewFile)}
                                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center space-x-2 transition-all shadow-md"
                                    >
                                        <i data-lucide="download" className="w-4 h-4"></i>
                                        <span>Download File</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* PAYMENT MODAL WITH REAL UPI QR & BANK SPECS */}
                    {paymentModalOpen && currentOrder && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
                            <div className="glass-panel max-w-lg w-full p-8 rounded-3xl border border-white/10 space-y-6 glow-emerald max-h-[90vh] overflow-y-auto relative">
                                <button onClick={() => setPaymentModalOpen(false)} className="absolute top-6 right-6 text-gray-400 hover:text-white">
                                    <i data-lucide="x" className="w-5 h-5"></i>
                                </button>

                                <div className="text-center space-y-1.5">
                                    <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider">
                                        Secure UPI Payment
                                    </span>
                                    <h3 className="text-2xl font-bold text-white">Unlock 4K Master Render</h3>
                                    <p className="text-xs text-gray-400">Amount Due: <strong className="text-white">${currentOrder.price} USD / ₹{paymentInfo ? paymentInfo.amountINR : currentOrder.price * 86} INR</strong></p>
                                </div>

                                {paymentInfo ? (
                                <>
                                <div className="flex flex-col items-center justify-center bg-white/5 p-4 rounded-2xl border border-emerald-500/30 text-center space-y-2">
                                    <div className="p-3 bg-white rounded-2xl shadow-xl">
                                        <img
                                            src={paymentInfo.qrUrl}
                                            alt="UPI Payment QR Code"
                                            className="w-44 h-44 object-contain"
                                        />
                                    </div>
                                    <span className="text-[11px] text-gray-300 font-mono">Scan with GPay, PhonePe, Paytm or BHIM (Amount: ₹{paymentInfo.amountINR})</span>
                                    <a href={paymentInfo.upiUri} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">
                                        Open in UPI app (on phone)
                                    </a>
                                </div>

                                <div className="glass-panel p-5 rounded-2xl border border-emerald-500/30 space-y-2.5 bg-emerald-950/20 text-xs font-mono">
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-400">Pay to:</span>
                                        <span className="text-white font-bold">{paymentInfo.accountName}</span>
                                    </div>
                                    <div className="flex justify-between items-center pt-2 border-t border-white/10">
                                        <span className="text-gray-400">UPI ID:</span>
                                        <span className="text-blue-400 font-bold select-all">{paymentInfo.upiId}</span>
                                    </div>
                                </div>
                                </>
                                ) : (
                                    <div className="text-center text-xs font-mono text-gray-400 py-8">
                                        {paymentInfoError || 'Loading secure payment details...'}
                                    </div>
                                )}

                                {/* UTR Submission Form */}
                                <form onSubmit={handlePaymentProofSubmit} className="space-y-4 pt-1 font-sans">
                                    <div>
                                        <label className="text-xs font-mono text-gray-300 block mb-1">
                                            Enter Transaction Reference / UTR Number *
                                        </label>
                                        <input 
                                            type="text" 
                                            required
                                            placeholder="e.g. UTR49281029384 or 329182049102"
                                            value={utrNumber}
                                            onChange={(e) => setUtrNumber(e.target.value)}
                                            className="w-full bg-black/60 border border-white/20 rounded-xl px-4 py-3 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                                        />
                                    </div>

                                    <button 
                                        type="submit"
                                        className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-xl flex items-center justify-center space-x-2"
                                    >
                                        <i data-lucide="check" className="w-4 h-4"></i>
                                        <span>Submit UTR & Register Payment</span>
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        // ==========================================
        // 2. DEDICATED EDITOR WORKSPACE
        // ==========================================
        function EditorWorkspace({ orders, onOrder, showAlert, currentUser }) {
            const editorAssignedOrders = orders.filter(o => 
                o.editor.toLowerCase().includes(currentUser.name.toLowerCase().split(' ')[0])
            );

            const [selectedOrderId, setSelectedOrderId] = useState(editorAssignedOrders[0]?.id || orders[0]?.id || '');
            const currentOrder = orders.find(o => o.id === selectedOrderId) || orders[0];

            const [editorReply, setEditorReply] = useState('');
            const [newDraftUrl, setNewDraftUrl] = useState('');
            const [selectedFolder, setSelectedFolder] = useState('Raw Footage');

            useEffect(() => {
                if (editorAssignedOrders.length > 0 && !editorAssignedOrders.some(o => o.id === selectedOrderId)) {
                    setSelectedOrderId(editorAssignedOrders[0].id);
                }
            }, [editorAssignedOrders]);

            const handleUploadDraft = async (e) => {
                e.preventDefault();
                if (!newDraftUrl.trim() || !currentOrder) return;
                try {
                    const { order } = await api('PUT', `/orders/${currentOrder.id}/draft`, { url: newDraftUrl.trim() });
                    onOrder(order);
                    setNewDraftUrl('');
                    showAlert('Draft Published!', 'New watermarked preview draft published to client.', 'success');
                } catch (err) {
                    showAlert('Draft Not Published', err.message, 'error');
                }
            };

            const handleSendEditorChat = async (e) => {
                e.preventDefault();
                if (!editorReply.trim() || !currentOrder) return;
                const text = editorReply.trim();
                setEditorReply('');
                try {
                    const { order } = await api('POST', `/orders/${currentOrder.id}/messages`, { text });
                    onOrder(order);
                } catch (err) {
                    setEditorReply(text);
                    showAlert('Message Not Sent', err.message, 'error');
                }
            };

            const currentFolders = currentOrder?.folders || ['Raw Footage', 'Audio & Music', 'Graphics & B-Roll'];
            const currentFiles = (currentOrder?.uploadedFiles || []).filter(f => (f.folder || 'Raw Footage') === selectedFolder);

            return (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fadeIn">
                    {/* Top Editor Banner */}
                    <div className="glass-panel p-6 rounded-3xl border border-purple-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4 glow-purple">
                        <div className="flex items-center space-x-4">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 to-blue-500 p-0.5 flex items-center justify-center">
                                <div className="w-full h-full bg-obsidian rounded-[14px] flex items-center justify-center text-purple-400 font-bold text-xl">
                                    {currentUser.name.charAt(0)}
                                </div>
                            </div>
                            <div>
                                <span className="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-mono font-bold uppercase tracking-wider">
                                    Dedicated Editor Workspace
                                </span>
                                <h2 className="text-2xl font-bold text-white mt-1">Welcome, {currentUser.name}</h2>
                                <p className="text-xs text-gray-400">Review assigned projects, inspect vaulted raw footage, and deliver export drafts.</p>
                            </div>
                        </div>

                        <div className="flex items-center space-x-3 bg-black/50 px-4 py-2.5 rounded-2xl border border-white/10 font-mono text-xs">
                            <span className="text-gray-400">Assigned Queue:</span>
                            <span className="text-purple-400 font-bold text-sm">{editorAssignedOrders.length} Projects</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                        {/* Sidebar */}
                        <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-4 lg:col-span-1">
                            <h3 className="text-xs font-mono text-gray-400 uppercase tracking-widest">Assigned Queue</h3>
                            {editorAssignedOrders.length === 0 ? (
                                <div className="text-center py-8 text-gray-500 text-xs italic">
                                    No briefs currently assigned to you. Admin will route incoming projects.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {editorAssignedOrders.map(o => (
                                        <button
                                            key={o.id}
                                            onClick={() => setSelectedOrderId(o.id)}
                                            className={`w-full text-left p-4 rounded-2xl transition-all border ${
                                                selectedOrderId === o.id 
                                                    ? 'bg-purple-600/25 border-purple-500/60 text-white shadow-lg' 
                                                    : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
                                            }`}
                                        >
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-mono text-xs font-bold text-purple-400">{o.id}</span>
                                                <span className={`w-2 h-2 rounded-full ${o.unlocked ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                                            </div>
                                            <p className="text-xs font-bold text-white truncate">{o.projectType}</p>
                                            <p className="text-[10px] text-gray-400 mt-0.5 truncate">Client: {o.clientName}</p>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Editor Workspace Main Area */}
                        {currentOrder ? (
                            <div className="lg:col-span-3 space-y-6">
                                <div className="glass-panel p-6 rounded-3xl border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div>
                                        <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-400 text-xs font-mono font-bold">
                                            Client: {currentOrder.clientName} ({currentOrder.clientEmail})
                                        </span>
                                        <h3 className="text-2xl font-bold text-white mt-2">{currentOrder.projectType}</h3>
                                        <p className="text-xs text-gray-400 mt-0.5">Phone: <strong className="text-white">{currentOrder.phone}</strong> &bull; Status: <strong className="text-emerald-400">{currentOrder.status}</strong></p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs font-mono text-gray-400 block">Agreed Budget:</span>
                                        <span className="text-xl font-bold text-white">${currentOrder.price} USD</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Video Draft Preview Box & Uploader */}
                                    <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-4">
                                        <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                                            <i data-lucide="play-circle" className="w-4 h-4 text-purple-400"></i>
                                            <span>Current Preview Draft</span>
                                        </h4>
                                        <div className="aspect-video bg-black rounded-2xl overflow-hidden relative">
                                            <video controls className="w-full h-full object-cover" src={currentOrder.draftUrl}></video>
                                        </div>

                                        <form onSubmit={handleUploadDraft} className="space-y-2 pt-2">
                                            <label className="text-xs font-mono text-gray-400 block">Publish New Preview Video URL (.mp4)</label>
                                            <div className="flex space-x-2">
                                                <input 
                                                    type="url" 
                                                    required
                                                    placeholder="https://... (direct video mp4 link)"
                                                    value={newDraftUrl}
                                                    onChange={(e) => setNewDraftUrl(e.target.value)}
                                                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                                                />
                                                <button type="submit" className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all">
                                                    Publish
                                                </button>
                                            </div>
                                        </form>
                                    </div>

                                    {/* Client Files & Vault Browser */}
                                    <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                                                <i data-lucide="folder" className="w-4 h-4 text-blue-400"></i>
                                                <span>Client Vaulted Assets</span>
                                            </h4>
                                            <div className="flex space-x-1 overflow-x-auto text-[10px] font-mono">
                                                {currentFolders.map(folder => (
                                                    <button
                                                        key={folder}
                                                        onClick={() => setSelectedFolder(folder)}
                                                        className={`px-2.5 py-1 rounded-lg ${selectedFolder === folder ? 'bg-blue-600 text-white font-bold' : 'bg-white/5 text-gray-400'}`}
                                                    >
                                                        {folder}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                            {currentFiles.length === 0 ? (
                                                <p className="text-xs text-gray-500 italic py-8 text-center">No files uploaded in [{selectedFolder}].</p>
                                            ) : (
                                                currentFiles.map(file => (
                                                    <div key={file.id} className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs font-mono">
                                                        <div className="truncate pr-2">
                                                            <p className="text-white font-bold truncate font-sans">{file.name}</p>
                                                            <p className="text-[10px] text-gray-400">{file.size} &bull; {file.date}</p>
                                                        </div>
                                                        <a 
                                                            href={file.url} 
                                                            target="_blank" 
                                                            rel="noreferrer"
                                                            className="px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white text-xs font-mono transition-colors"
                                                        >
                                                            Download
                                                        </a>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Editor-Client Chat */}
                                <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-4">
                                    <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                                        <i data-lucide="message-square" className="w-4 h-4 text-purple-400"></i>
                                        <span>Direct Chat with Client</span>
                                    </h4>

                                    <div className="max-h-48 overflow-y-auto space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 text-xs">
                                        {(currentOrder.chatMessages || []).map((msg, idx) => (
                                            <div key={idx} className="text-xs">
                                                <span className="font-mono text-gray-500 mr-2">[{msg.time}]</span>
                                                <span className={msg.sender === 'editor' ? 'text-purple-400 font-bold' : msg.sender === 'client' ? 'text-blue-400' : 'text-gray-300'}>
                                                    {msg.text}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    <form onSubmit={handleSendEditorChat} className="flex space-x-2">
                                        <input 
                                            type="text" 
                                            placeholder="Send production update or notes to client..."
                                            value={editorReply}
                                            onChange={(e) => setEditorReply(e.target.value)}
                                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500"
                                        />
                                        <button type="submit" className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all">
                                            Send
                                        </button>
                                    </form>
                                </div>
                            </div>
                        ) : (
                            <div className="lg:col-span-3 glass-panel p-12 rounded-3xl text-center space-y-4">
                                <h3 className="text-xl font-bold text-white">No Projects Selected</h3>
                                <p className="text-xs text-gray-400">Select an assigned project from the sidebar to begin editing.</p>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        // ==========================================
        // 3. STUDIO STAFF / ADMIN CONSOLE
        // ==========================================
        function AdminDashboard({ orders, onOrder, showAlert, currentUser, onRosterChange, onConfigChange }) {
            const [tab, setTab] = useState('orders');
            const [selectedOrderId, setSelectedOrderId] = useState(orders[0]?.id || '');
            const [adminReply, setAdminReply] = useState('');
            const [newCleanUrl, setNewCleanUrl] = useState('');
            const [newDraftUrl, setNewDraftUrl] = useState('');
            const [reassignEditorName, setReassignEditorName] = useState(EDITORS_LIST[0] ? EDITORS_LIST[0].id : '');

            // Price modification controls
            const [customPriceUSD, setCustomPriceUSD] = useState('');
            const [customEditorPayoutUSD, setCustomEditorPayoutUSD] = useState('');

            const currentOrder = orders.find(o => o.id === selectedOrderId) || orders[0];

            useEffect(() => {
                if (orders.length > 0 && !orders.some(o => o.id === selectedOrderId)) {
                    setSelectedOrderId(orders[0].id);
                }
            }, [orders]);

            useEffect(() => {
                if (currentOrder) {
                    setCustomPriceUSD(currentOrder.price);
                    setCustomEditorPayoutUSD(currentOrder.editorPayout || Math.round(currentOrder.price * 0.45));
                }
            }, [selectedOrderId]);

            const totalRevenueUSD = orders.reduce((sum, o) => sum + (o.unlocked ? o.price : 0), 0);
            const totalRevenueINR = totalRevenueUSD * 86;
            const pendingVerifications = orders.filter(o => o.paymentProof && !o.unlocked).length;
            const pendingNegotiations = orders.filter(o => o.negotiation && o.negotiation.status === 'PENDING_ADMIN_REVIEW').length;

            const failWith = (title) => (err) => showAlert(title, err.message, 'error');

            const handleUnlockMaster = async (unlockedState) => {
                if (!currentOrder) return;
                try {
                    const { order } = await api('POST', `/admin/orders/${currentOrder.id}/unlock`, { unlocked: unlockedState });
                    onOrder(order);
                    showAlert('Project Master Updated', unlockedState ? '4K Master render unlocked for client.' : 'Project marked as locked draft.', 'success');
                } catch (err) {
                    failWith('Could Not Update Master')(err);
                }
            };

            const handleSaveCustomPricing = async (e) => {
                e.preventDefault();
                if (!currentOrder) return;
                const newPrice = Number(customPriceUSD);
                const newPayout = Number(customEditorPayoutUSD);

                if (newPrice <= 0) {
                    showAlert('Invalid Pricing', 'Please enter a valid price amount.', 'error');
                    return;
                }
                const profitUSD = newPrice - newPayout;
                try {
                    const { order } = await api('POST', `/admin/orders/${currentOrder.id}/pricing`, { price: newPrice, editorPayout: newPayout });
                    onOrder(order);
                    showAlert('Pricing Updated!', `Order ${currentOrder.id} price set to $${newPrice} USD. Profit margin: $${profitUSD} USD.`, 'success');
                } catch (err) {
                    failWith('Pricing Not Saved')(err);
                }
            };

            const handleAcceptNegotiation = async () => {
                if (!currentOrder || !currentOrder.negotiation) return;
                try {
                    const { order } = await api('POST', `/admin/orders/${currentOrder.id}/negotiation`, { decision: 'accept' });
                    onOrder(order);
                    setCustomPriceUSD(order.price);
                    setCustomEditorPayoutUSD(order.editorPayout);
                    showAlert('Offer Accepted!', `Client price updated to $${order.price} USD.`, 'success');
                } catch (err) {
                    failWith('Could Not Accept Offer')(err);
                }
            };

            const handleRejectNegotiation = async () => {
                if (!currentOrder || !currentOrder.negotiation) return;
                try {
                    const { order } = await api('POST', `/admin/orders/${currentOrder.id}/negotiation`, { decision: 'decline' });
                    onOrder(order);
                    showAlert('Offer Declined', 'Negotiation declined. Original price preserved.', 'info');
                } catch (err) {
                    failWith('Could Not Decline Offer')(err);
                }
            };

            const handleReassignEditor = async (e) => {
                e.preventDefault();
                if (!currentOrder) return;
                try {
                    const { order } = await api('POST', `/admin/orders/${currentOrder.id}/reassign`, { editorId: reassignEditorName });
                    onOrder(order);
                    showAlert('Editor Reassigned', `Project successfully routed to ${order.editor} workspace.`, 'success');
                } catch (err) {
                    failWith('Could Not Reassign')(err);
                }
            };

            const [adminPrivate, setAdminPrivate] = useState(false);
            const handleSendAdminMessage = async (e) => {
                e.preventDefault();
                if (!adminReply.trim() || !currentOrder) return;
                const text = adminReply.trim();
                setAdminReply('');
                try {
                    const { order } = await api('POST', `/orders/${currentOrder.id}/messages`, { text, private: adminPrivate });
                    onOrder(order);
                } catch (err) {
                    setAdminReply(text);
                    failWith('Message Not Sent')(err);
                }
            };

            const handleUpdateLinks = async (e) => {
                e.preventDefault();
                if (!currentOrder) return;
                try {
                    const { order } = await api('PUT', `/admin/orders/${currentOrder.id}/links`, {
                        draftUrl: newDraftUrl.trim() || null, cleanUrl: newCleanUrl.trim() || null
                    });
                    onOrder(order);
                    setNewCleanUrl('');
                    setNewDraftUrl('');
                    showAlert('Render Links Updated', 'Video export URLs updated across client and editor dashboards.', 'success');
                } catch (err) {
                    failWith('Links Not Updated')(err);
                }
            };

            return (
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fadeIn">
                    {/* Admin Header Stats */}
                    <div className="glass-panel p-6 rounded-3xl border border-emerald-500/30 flex flex-col md:flex-row md:items-center justify-between gap-6 glow-emerald">
                        <div>
                            <div className="flex items-center space-x-3">
                                <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider">
                                    Studio Executive Dashboard
                                </span>
                                <span className="text-xs font-mono text-gray-400">Staff: {currentUser.name}</span>
                            </div>
                            <h2 className="text-2xl md:text-3xl font-extrabold text-white mt-1">Lilizzh Operations & Pricing Authority</h2>
                            <p className="text-xs text-gray-400 mt-0.5">Control pricing, review client negotiations, track profit margins, verify UPI payments, and unlock 4K masters.</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                            <div className="glass-panel px-4 py-2.5 rounded-2xl border border-white/10 text-center">
                                <span className="text-gray-400 block text-[10px]">VERIFIED REVENUE</span>
                                <span className="text-lg font-bold text-emerald-400">${totalRevenueUSD} USD</span>
                                <span className="text-[10px] text-gray-400 block font-sans">₹{totalRevenueINR} INR</span>
                            </div>

                            <div className="glass-panel px-4 py-2.5 rounded-2xl border border-white/10 text-center">
                                <span className="text-gray-400 block text-[10px]">PENDING UTRs</span>
                                <span className="text-lg font-bold text-amber-400">{pendingVerifications} Requests</span>
                            </div>

                            <div className="glass-panel px-4 py-2.5 rounded-2xl border border-purple-500/30 text-center">
                                <span className="text-gray-400 block text-[10px]">NEGOTIATIONS</span>
                                <span className="text-lg font-bold text-purple-400">{pendingNegotiations} Offers</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs font-mono">
                        {[['orders', 'Orders'], ['editors', 'Editors'], ['pricing', 'Pricing'], ['inquiries', 'Inquiries']].map(([id, label]) => (
                            <button key={id} type="button" onClick={() => setTab(id)}
                                className={`px-4 py-2 rounded-xl border transition-all ${tab === id ? 'bg-emerald-600 text-white border-emerald-500 font-bold' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'}`}>
                                {label}
                            </button>
                        ))}
                    </div>

                    {tab === 'editors' && <AdminEditors showAlert={showAlert} onRosterChange={onRosterChange} />}
                    {tab === 'pricing' && <AdminPricing showAlert={showAlert} onConfigChange={onConfigChange} />}
                    {tab === 'inquiries' && <AdminInquiries showAlert={showAlert} />}

                    {tab === 'orders' && (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                        {/* Orders List */}
                        <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-4 lg:col-span-1">
                            <h3 className="text-xs font-mono text-gray-400 uppercase tracking-widest">Incoming Client Orders ({orders.length})</h3>
                            <div className="space-y-2">
                                {orders.map(o => (
                                    <button
                                        key={o.id}
                                        onClick={() => setSelectedOrderId(o.id)}
                                        className={`w-full text-left p-4 rounded-2xl transition-all border ${
                                            selectedOrderId === o.id 
                                                ? 'bg-blue-600/20 border-blue-500/50 text-white shadow-lg' 
                                                : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
                                        }`}
                                    >
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-mono text-xs font-bold text-blue-400">{o.id}</span>
                                            <div className="flex items-center space-x-1">
                                                {o.negotiation && o.negotiation.status === 'PENDING_ADMIN_REVIEW' && (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-500/30 text-purple-300 font-mono font-bold">NEG</span>
                                                )}
                                                <span className={`w-2 h-2 rounded-full ${o.unlocked ? 'bg-emerald-400' : o.paymentProof ? 'bg-amber-400 animate-pulse' : 'bg-gray-600'}`}></span>
                                            </div>
                                        </div>
                                        <p className="text-xs font-bold text-white truncate">{o.projectType}</p>
                                        <div className="flex justify-between items-center text-[10px] text-gray-400 mt-1">
                                            <span>{o.clientName}</span>
                                            <span className="text-emerald-400 font-mono font-bold">${o.price}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Order Management Detailed Area */}
                        {currentOrder && (
                            <div className="lg:col-span-3 space-y-6">
                                <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-6">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
                                        <div>
                                            <div className="flex items-center space-x-3">
                                                <h3 className="text-xl font-bold text-white">{currentOrder.projectType}</h3>
                                                <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold ${
                                                    currentOrder.unlocked ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                                                }`}>
                                                    {currentOrder.unlocked ? 'UNLOCKED' : 'LOCKED / WATERMARKED DRAFT'}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-400 mt-1">
                                                Client: <strong className="text-white">{currentOrder.clientName}</strong> ({currentOrder.clientEmail}) &bull; Phone: <strong className="text-emerald-400">{currentOrder.phone}</strong> &bull; Editor: <strong className="text-purple-400">{currentOrder.editor}</strong>
                                            </p>
                                        </div>

                                        <div className="flex items-center space-x-3">
                                            <button 
                                                onClick={() => handleUnlockMaster(!currentOrder.unlocked)}
                                                className={`px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-lg ${
                                                    currentOrder.unlocked 
                                                        ? 'bg-amber-600 hover:bg-amber-500 text-white' 
                                                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/25'
                                                }`}
                                            >
                                                {currentOrder.unlocked ? 'Lock to Draft Mode' : 'Verify & Unlock Clean 4K Master'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* CLIENT NEGOTIATION REVIEW CARD (If present) */}
                                    {currentOrder.negotiation && (
                                        <div className="p-5 rounded-2xl bg-purple-950/30 border border-purple-500/40 space-y-3 glow-purple">
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                <div className="flex items-center space-x-2 text-purple-300 font-bold font-mono text-xs">
                                                    <i data-lucide="scale" className="w-4 h-4"></i>
                                                    <span>Client Price Negotiation Request</span>
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/20 border border-purple-500/30 text-purple-200">
                                                        {currentOrder.negotiation.status}
                                                    </span>
                                                </div>
                                                <span className="text-[10px] text-gray-400 font-mono">
                                                    Current Price: ${currentOrder.price} &rarr; Requested: <strong className="text-emerald-400 text-xs">${currentOrder.negotiation.proposedPrice}</strong>
                                                </span>
                                            </div>

                                            <p className="text-xs text-gray-300 font-sans italic bg-black/40 p-3 rounded-xl border border-white/5">
                                                "{currentOrder.negotiation.clientNote || 'No specific note provided'}"
                                            </p>

                                            {currentOrder.negotiation.status === 'PENDING_ADMIN_REVIEW' && (
                                                <div className="flex flex-wrap items-center gap-3 pt-1">
                                                    <button
                                                        onClick={handleAcceptNegotiation}
                                                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all flex items-center space-x-1.5"
                                                    >
                                                        <i data-lucide="check" className="w-3.5 h-3.5"></i>
                                                        <span>Accept Offer (${currentOrder.negotiation.proposedPrice})</span>
                                                    </button>
                                                    <button
                                                        onClick={handleRejectNegotiation}
                                                        className="px-4 py-2 rounded-xl bg-red-600/30 hover:bg-red-600 text-red-300 hover:text-white font-bold text-xs border border-red-500/40 transition-all flex items-center space-x-1.5"
                                                    >
                                                        <i data-lucide="x" className="w-3.5 h-3.5"></i>
                                                        <span>Decline Offer</span>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ADMIN PRICING & PROFIT CALCULATOR BOX */}
                                    <form onSubmit={handleSaveCustomPricing} className="p-5 rounded-2xl bg-black/50 border border-emerald-500/30 space-y-4">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
                                            <div className="flex items-center space-x-2">
                                                <i data-lucide="calculator" className="w-4 h-4 text-emerald-400"></i>
                                                <h4 className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                                                    Admin Pricing Authority & Margin Control
                                                </h4>
                                            </div>
                                            <span className="text-[11px] font-mono text-gray-400">
                                                Rate Card Benchmark: <strong className="text-emerald-400">{RATE_CARD.find(r => r.type === currentOrder.projectType)?.clientPriceRangeUSD || '$25 - $200'}</strong>
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
                                            <div>
                                                <label className="text-gray-400 block mb-1">Client Agreed Price ($ USD)</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-2.5 text-gray-500">$</span>
                                                    <input 
                                                        type="number" 
                                                        required
                                                        min="1"
                                                        value={customPriceUSD}
                                                        onChange={(e) => setCustomPriceUSD(e.target.value)}
                                                        className="w-full bg-white/5 border border-white/15 rounded-xl pl-7 pr-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
                                                    />
                                                </div>
                                                <span className="text-[10px] text-gray-500 mt-1 block">
                                                    = ₹{(Number(customPriceUSD) || 0) * 86} INR
                                                </span>
                                            </div>

                                            <div>
                                                <label className="text-gray-400 block mb-1">Editor Payout ($ USD)</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-2.5 text-gray-500">$</span>
                                                    <input 
                                                        type="number" 
                                                        required
                                                        min="0"
                                                        value={customEditorPayoutUSD}
                                                        onChange={(e) => setCustomEditorPayoutUSD(e.target.value)}
                                                        className="w-full bg-white/5 border border-white/15 rounded-xl pl-7 pr-3 py-2 text-white font-mono focus:outline-none focus:border-purple-500"
                                                    />
                                                </div>
                                                <span className="text-[10px] text-gray-500 mt-1 block">
                                                    = ₹{(Number(customEditorPayoutUSD) || 0) * 86} INR
                                                </span>
                                            </div>

                                            <div className="glass-panel p-3 rounded-xl border border-white/10 flex flex-col justify-center">
                                                <span className="text-gray-400 text-[10px]">STUDIO GROSS PROFIT</span>
                                                <span className="text-lg font-bold text-emerald-400 font-mono">
                                                    ${(Number(customPriceUSD) || 0) - (Number(customEditorPayoutUSD) || 0)} USD
                                                </span>
                                                <span className="text-[10px] text-gray-400 font-mono">
                                                    ₹{((Number(customPriceUSD) || 0) - (Number(customEditorPayoutUSD) || 0)) * 86} INR
                                                </span>
                                            </div>
                                        </div>

                                        <button 
                                            type="submit"
                                            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-md flex items-center space-x-1.5"
                                        >
                                            <i data-lucide="check-check" className="w-4 h-4"></i>
                                            <span>Apply & Update Project Pricing</span>
                                        </button>
                                    </form>

                                    {/* UTR Verification Alert Card */}
                                    {currentOrder.paymentProof ? (
                                        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                            <div>
                                                <div className="flex items-center space-x-2 text-emerald-400 text-xs font-mono font-bold">
                                                    <i data-lucide="check-circle" className="w-4 h-4"></i>
                                                    <span>Client Submitted Payment Proof (UTR)</span>
                                                </div>
                                                <p className="text-xs font-mono text-white mt-1">Reference: <strong>{currentOrder.paymentProof.utr}</strong></p>
                                                <p className="text-[10px] text-gray-400 font-mono">Method: {currentOrder.paymentProof.method} &bull; Time: {currentOrder.paymentProof.timestamp || 'Recent'}</p>
                                            </div>

                                            {!currentOrder.unlocked && (
                                                <button 
                                                    onClick={() => handleUnlockMaster(true)}
                                                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg transition-all"
                                                >
                                                    Approve UTR & Unlock
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-xs font-mono text-gray-400">
                                            No UTR payment reference submitted yet by this client.
                                        </div>
                                    )}

                                    {/* Reassign Editor */}
                                    <form onSubmit={handleReassignEditor} className="p-4 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                        <div>
                                            <h4 className="text-xs font-mono text-purple-300 font-bold">Assign Project to Dedicated Editor</h4>
                                            <p className="text-[10px] text-gray-400">Route project briefs among Marcus Vance, Elena Rostova, Devon Sterling, or Aria Chen.</p>
                                        </div>
                                        <div className="flex space-x-2">
                                            <select 
                                                value={reassignEditorName}
                                                onChange={(e) => setReassignEditorName(e.target.value)}
                                                className="bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                                            >
                                                {EDITORS_LIST.map(ed => (
                                                    <option key={ed.id} value={ed.id}>{ed.name} ({ed.tag})</option>
                                                ))}
                                            </select>
                                            <button type="submit" className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all">
                                                Reassign
                                            </button>
                                        </div>
                                    </form>

                                    {/* Link Management Form */}
                                    <form onSubmit={handleUpdateLinks} className="space-y-4 pt-2 border-t border-white/10 font-sans text-xs">
                                        <h4 className="text-xs font-mono text-gray-400 uppercase font-bold">Manage Video Export Links</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-xs font-mono text-gray-400 block mb-1">Watermarked Draft Video URL (.mp4)</label>
                                                <input 
                                                    type="url" 
                                                    placeholder={currentOrder.draftUrl}
                                                    value={newDraftUrl}
                                                    onChange={(e) => setNewDraftUrl(e.target.value)}
                                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono focus:outline-none focus:border-blue-500"
                                                />
                                            </div>

                                            <div>
                                                <label className="text-xs font-mono text-gray-400 block mb-1">Clean 4K Master Video URL (.mp4)</label>
                                                <input 
                                                    type="url" 
                                                    placeholder={currentOrder.cleanUrl}
                                                    value={newCleanUrl}
                                                    onChange={(e) => setNewCleanUrl(e.target.value)}
                                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono focus:outline-none focus:border-blue-500"
                                                />
                                            </div>
                                        </div>

                                        <button 
                                            type="submit" 
                                            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-md"
                                        >
                                            Update Export URLs
                                        </button>
                                    </form>

                                    {/* Admin Broadcast Chat */}
                                    <div className="space-y-3 pt-2 border-t border-white/10">
                                        <h4 className="text-xs font-mono text-gray-400 uppercase font-bold">Direct Studio Staff Chat & Broadcast</h4>
                                        <div className="max-h-44 overflow-y-auto space-y-2 p-3 rounded-2xl bg-black/40 border border-white/5 text-xs">
                                            {(currentOrder.chatMessages || []).map((msg, idx) => (
                                                <div key={idx} className="text-xs">
                                                    <span className="font-mono text-gray-500 mr-2">[{msg.time}]</span>
                                                    {msg.private && <span className="mr-1 px-1.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-mono">PRIVATE</span>}
                                                    <span className={msg.sender === 'system' ? 'text-emerald-400 font-bold' : msg.sender === 'client' ? 'text-blue-400' : 'text-purple-400'}>
                                                        {msg.text}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>

                                        <label className="flex items-center space-x-2 text-[11px] font-mono text-gray-400 cursor-pointer select-none">
                                            <input type="checkbox" checked={adminPrivate} onChange={(e) => setAdminPrivate(e.target.checked)} />
                                            <span>Private to this client only (editor will not see it)</span>
                                        </label>
                                        <form onSubmit={handleSendAdminMessage} className="flex space-x-2">
                                            <input 
                                                type="text" 
                                                placeholder="Reply as Studio Staff..."
                                                value={adminReply}
                                                onChange={(e) => setAdminReply(e.target.value)}
                                                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-sans"
                                            />
                                            <button type="submit" className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all">
                                                Broadcast Note
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    )}
                </div>
            );
        }


        // ------------------------------------------------------------------ Admin: editors
        const EMPTY_EDITOR = { name: '', roleTitle: '', tag: 'YouTube', email: '', bio: '', badge: '' };

        function AdminEditors({ showAlert, onRosterChange }) {
            const [list, setList] = useState([]);
            const [form, setForm] = useState(EMPTY_EDITOR);
            const [editing, setEditing] = useState(null);   // editor id being edited
            const [draft, setDraft] = useState({});
            const [secret, setSecret] = useState(null);     // { name, passcode } shown once
            const [busy, setBusy] = useState(false);

            const load = async () => {
                try { setList((await api('GET', '/admin/editors')).editors); }
                catch (err) { showAlert('Could Not Load Editors', err.message, 'error'); }
            };
            useEffect(() => { load(); }, []);

            const done = async () => { await load(); if (onRosterChange) onRosterChange(); };
            const run = async (fn, errTitle) => {
                if (busy) return;
                setBusy(true);
                try { await fn(); } catch (err) { showAlert(errTitle, err.message, 'error'); }
                setBusy(false);
            };

            const addEditor = (e) => {
                e.preventDefault();
                run(async () => {
                    const body = { name: form.name, roleTitle: form.roleTitle, tag: form.tag, email: form.email };
                    if (form.bio.trim()) body.bio = form.bio;
                    if (form.badge.trim()) body.badge = form.badge;
                    const r = await api('POST', '/admin/editors', body);
                    setSecret({ name: r.editor.name, id: r.editor.id, passcode: r.passcode });
                    setForm(EMPTY_EDITOR);
                    await done();
                }, 'Editor Not Added');
            };
            const saveEdit = (id) => run(async () => {
                await api('PUT', `/admin/editors/${id}`, draft);
                setEditing(null);
                await done();
                showAlert('Editor Updated', 'Changes are live on the website.', 'success');
            }, 'Editor Not Updated');
            const remove = (ed) => {
                if (!window.confirm(`Remove ${ed.name}? They will be hidden from clients and signed out.` +
                    (ed.openOrders ? ` They still have ${ed.openOrders} open order(s) - reassign them from the Orders tab.` : ''))) return;
                run(async () => { await api('POST', `/admin/editors/${ed.id}/remove`); await done(); }, 'Editor Not Removed');
            };
            const restore = (ed) => run(async () => { await api('POST', `/admin/editors/${ed.id}/restore`); await done(); }, 'Editor Not Restored');
            const resetCode = (ed) => {
                if (!window.confirm(`Create a new passcode for ${ed.name}? Their old one stops working immediately.`)) return;
                run(async () => {
                    const r = await api('POST', `/admin/editors/${ed.id}/passcode`);
                    setSecret({ name: ed.name, id: ed.id, passcode: r.passcode });
                }, 'Passcode Not Reset');
            };

            const input = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500';

            return (
                <div className="space-y-6">
                    {secret && (
                        <div className="glass-panel p-5 rounded-3xl border border-amber-500/40 bg-amber-950/20 space-y-2" data-testid="passcode-box">
                            <div className="text-xs font-mono text-amber-300 font-bold uppercase">One-time passcode - copy it now, it is never shown again</div>
                            <div className="text-xs text-gray-300">{secret.name} signs in as <strong className="text-white">{secret.id}</strong> with passcode:</div>
                            <div className="text-lg font-mono font-bold text-emerald-300 select-all" data-testid="passcode-value">{secret.passcode}</div>
                            <button type="button" onClick={() => setSecret(null)} className="text-[11px] font-mono text-gray-400 hover:text-white underline">I have saved it</button>
                        </div>
                    )}

                    <form onSubmit={addEditor} className="glass-panel p-6 rounded-3xl border border-white/10 space-y-3">
                        <h3 className="text-xs font-mono text-gray-400 uppercase tracking-widest">Add a new editor</h3>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <input required className={input} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                            <input required className={input} placeholder="Role (e.g. Colorist)" value={form.roleTitle} onChange={(e) => setForm({ ...form, roleTitle: e.target.value })} />
                            <select className={input} value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })}>
                                {['YouTube', 'Shorts', 'Documentary', 'Ads'].map(t => <option key={t} value={t} className="bg-black">{t}</option>)}
                            </select>
                            <input required type="email" className={input} placeholder="Editor email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                            <input className={`${input} md:col-span-3`} placeholder="Short bio (optional)" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
                            <input className={input} placeholder="Badge (optional)" value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} />
                        </div>
                        <button disabled={busy} type="submit" className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50">Add editor &amp; create passcode</button>
                    </form>

                    <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-3">
                        <h3 className="text-xs font-mono text-gray-400 uppercase tracking-widest">Team ({list.filter(x => x.active).length} active)</h3>
                        {list.map(ed => (
                            <div key={ed.id} className={`p-4 rounded-2xl border ${ed.active ? 'bg-white/5 border-white/10' : 'bg-black/40 border-white/5 opacity-70'}`} data-testid={`editor-${ed.id}`}>
                                {editing === ed.id ? (
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                        <input className={input} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name" />
                                        <input className={input} value={draft.roleTitle ?? ''} onChange={(e) => setDraft({ ...draft, roleTitle: e.target.value })} placeholder="Role" />
                                        <input className={input} value={draft.tag ?? ''} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} placeholder="Tag" />
                                        <input className={input} value={draft.email ?? ''} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="Email" />
                                        <input className={`${input} md:col-span-4`} value={draft.bio ?? ''} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} placeholder="Bio" />
                                        <div className="flex gap-2">
                                            <button disabled={busy} onClick={() => saveEdit(ed.id)} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">Save</button>
                                            <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl bg-white/5 text-gray-300 text-xs">Cancel</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="text-xs">
                                            <div className="text-white font-bold text-sm">{ed.name} <span className="font-mono text-gray-500 text-[10px]">{ed.id}</span>
                                                {!ed.active && <span className="ml-2 px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-mono">REMOVED</span>}</div>
                                            <div className="text-gray-400 font-mono">{ed.roleTitle} · {ed.tag} · {ed.email} · {ed.openOrders} open order(s)</div>
                                        </div>
                                        <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                                            <button onClick={() => { setEditing(ed.id); setDraft({ name: ed.name, roleTitle: ed.roleTitle, tag: ed.tag, email: ed.email, bio: ed.bio }); }} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200">Rename / Edit</button>
                                            {ed.active && <button onClick={() => resetCode(ed)} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200">New passcode</button>}
                                            {ed.active
                                                ? <button onClick={() => remove(ed)} className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300">Remove</button>
                                                : <button onClick={() => restore(ed)} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300">Restore</button>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

        // ------------------------------------------------------------------ Admin: default prices
        function AdminPricing({ showAlert, onConfigChange }) {
            const [rows, setRows] = useState(RATE_CARD.map(r => ({ ...r })));
            const [edits, setEdits] = useState({});
            const [busy, setBusy] = useState(false);

            const set = (id, key, value) => setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
            const save = async (row) => {
                const e = edits[row.id] || {};
                const body = {};
                if (e.price !== undefined && e.price !== '') body.price = Number(e.price);
                if (e.payout !== undefined && e.payout !== '') body.payout = Number(e.payout);
                if (e.priceRange) body.priceRange = e.priceRange;
                if (e.payoutRange) body.payoutRange = e.payoutRange;
                if (e.turnaround) body.turnaround = e.turnaround;
                if (Object.keys(body).length === 0) { showAlert('Nothing To Save', 'Change a value first.', 'info'); return; }
                setBusy(true);
                try {
                    const r = await api('PUT', `/admin/rates/${row.id}`, body);
                    setRows(r.rateCard);
                    setEdits(prev => ({ ...prev, [row.id]: {} }));
                    if (onConfigChange) onConfigChange();
                    showAlert('Prices Updated', `${row.type} now uses the new defaults for new orders.`, 'success');
                } catch (err) { showAlert('Prices Not Saved', err.message, 'error'); }
                setBusy(false);
            };
            const input = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono';

            return (
                <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-4">
                    <h3 className="text-xs font-mono text-gray-400 uppercase tracking-widest">Default prices (apply to NEW orders; existing orders keep their price)</h3>
                    {rows.map(row => {
                        const e = edits[row.id] || {};
                        return (
                            <div key={row.id} className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2" data-testid={`rate-${row.id}`}>
                                <div className="text-sm text-white font-bold">{row.type} <span className="text-[10px] text-gray-500 font-mono">{row.id}</span></div>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[10px] font-mono text-gray-400">
                                    <label>Client price (USD)<input type="number" min="1" className={input} defaultValue={row.clientPriceDefault} key={row.clientPriceDefault} onChange={(ev) => set(row.id, 'price', ev.target.value)} /></label>
                                    <label>Editor payout (USD)<input type="number" min="0" className={input} defaultValue={row.editorPayoutDefault} key={'p' + row.editorPayoutDefault} onChange={(ev) => set(row.id, 'payout', ev.target.value)} /></label>
                                    <label>Price range<input className={input} defaultValue={row.clientPriceRangeUSD} key={row.clientPriceRangeUSD} onChange={(ev) => set(row.id, 'priceRange', ev.target.value)} /></label>
                                    <label>Payout range<input className={input} defaultValue={row.editorPayoutRangeUSD} key={row.editorPayoutRangeUSD} onChange={(ev) => set(row.id, 'payoutRange', ev.target.value)} /></label>
                                    <label>Turnaround<input className={input} defaultValue={row.typicalTurnaround} key={row.typicalTurnaround} onChange={(ev) => set(row.id, 'turnaround', ev.target.value)} /></label>
                                </div>
                                <div className="text-[10px] font-mono text-gray-500">Profit range: {row.profitRangeUSD} ({row.profitRangeINR})</div>
                                <button disabled={busy} onClick={() => save(row)} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50">Save {row.type}</button>
                            </div>
                        );
                    })}
                </div>
            );
        }

        // ------------------------------------------------------------------ Admin: website inquiries
        function AdminInquiries({ showAlert }) {
            const [rows, setRows] = useState(null);
            useEffect(() => {
                api('GET', '/admin/inquiries').then(r => setRows(r.inquiries)).catch(err => showAlert('Could Not Load Inquiries', err.message, 'error'));
            }, []);
            return (
                <div className="glass-panel p-6 rounded-3xl border border-white/10 space-y-3">
                    <h3 className="text-xs font-mono text-gray-400 uppercase tracking-widest">Website inquiries {rows ? `(${rows.length})` : ''}</h3>
                    {rows && rows.length === 0 && <div className="text-xs text-gray-400">No inquiries yet.</div>}
                    {(rows || []).map(r => (
                        <div key={r.id} className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-gray-300 flex flex-wrap gap-x-4">
                            <strong className="text-white">{r.name}</strong><span>{r.email}</span><span>{r.phone}</span><span className="text-gray-500">{r.created_at}</span>
                        </div>
                    ))}
                </div>
            );
        }

        // Render React DOM Root
        const rootElement = document.getElementById('root');
        const root = ReactDOM.createRoot(rootElement);
        root.render(<App />);
