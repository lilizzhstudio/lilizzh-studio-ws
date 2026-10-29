const { useState, useEffect, useRef } = React;
function CustomModal({ isOpen, title, message, onClose, type = "info" }) {
  if (!isOpen) return null;
  return /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel max-w-md w-full p-6 rounded-3xl border border-white/10 glow-blue" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3 mb-4" }, /* @__PURE__ */ React.createElement("div", { className: `p-3 rounded-2xl ${type === "success" ? "bg-emerald-500/20 text-emerald-400" : type === "error" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"}` }, /* @__PURE__ */ React.createElement("i", { "data-lucide": type === "success" ? "check-circle-2" : type === "error" ? "alert-triangle" : "info", className: "w-6 h-6" })), /* @__PURE__ */ React.createElement("h3", { className: "text-xl font-bold text-white" }, title)), /* @__PURE__ */ React.createElement("p", { className: "text-gray-300 text-sm mb-6 leading-relaxed font-sans" }, message), /* @__PURE__ */ React.createElement("div", { className: "flex justify-end" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: onClose,
      className: "px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-all shadow-lg shadow-blue-500/25"
    },
    "Understood"
  ))));
}
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
const API_HEADERS = { "X-Requested-With": "lilizzh-web" };
async function api(method, path, body) {
  const options = { method, credentials: "same-origin", headers: { ...API_HEADERS } };
  if (body !== void 0) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch("/api" + path, options);
  } catch (networkError) {
    throw new ApiError("Cannot reach the server. Please check your connection and try again.", 0);
  }
  let data = null;
  try {
    data = await response.json();
  } catch (parseError) {
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event("lz-unauthorized"));
    }
    throw new ApiError(data && data.detail || "Something went wrong. Please try again.", response.status);
  }
  return data;
}
function uploadFile(orderId, folder, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const query = new URLSearchParams({ folder, name: file.name });
    xhr.open("POST", `/api/orders/${encodeURIComponent(orderId)}/files?${query}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Requested-With", "lilizzh-web");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) onProgress(Math.round(evt.loaded / evt.total * 100));
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (parseError) {
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data && data.detail || "Upload failed. Please try again.", xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Upload failed. Please check your connection.", 0));
    xhr.send(file);
  });
}
const RATE_CARD = [];
const EDITORS_LIST = [];
const CONTACT = { value: null };
function ContactLinks({ variant, onSignIn }) {
  const c = CONTACT.value;
  if (!c) {
    return onSignIn ? /* @__PURE__ */ React.createElement("button", { type: "button", onClick: onSignIn, className: "flex items-center space-x-1.5 hover:text-blue-400 transition-colors" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "lock", className: "w-3.5 h-3.5 text-blue-400" }), /* @__PURE__ */ React.createElement("span", null, "Sign in to contact the studio")) : null;
  }
  const subject = encodeURIComponent("Video Production Inquiry - Lilizzh Studio");
  return /* @__PURE__ */ React.createElement(React.Fragment, null, c.email && /* @__PURE__ */ React.createElement("a", { href: `mailto:${c.email}?subject=${subject}`, className: "flex items-center space-x-1.5 hover:text-blue-400 transition-colors", title: "Email Lilizzh Studio" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "mail", className: "w-3.5 h-3.5 text-blue-400" }), /* @__PURE__ */ React.createElement("span", null, c.email)), c.whatsapp && /* @__PURE__ */ React.createElement("a", { href: `https://wa.me/${c.whatsapp}`, target: "_blank", rel: "noopener noreferrer", className: "flex items-center space-x-1.5 hover:text-emerald-400 transition-colors text-emerald-400 font-bold", title: "Direct WhatsApp" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "message-circle", className: "w-3.5 h-3.5" }), /* @__PURE__ */ React.createElement("span", null, c.whatsappDisplay || c.whatsapp)));
}
function App() {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [modal, setModal] = useState({ isOpen: false, title: "", message: "", type: "info" });
  const [currentUser, setCurrentUser] = useState(null);
  const [orders, setOrders] = useState([]);
  const lastLocalChange = useRef(0);
  const [, setConfigVersion] = useState(0);
  const applyConfig = (config) => {
    RATE_CARD.splice(0, RATE_CARD.length, ...config.rateCard);
    CONTACT.value = config.contact || null;
    setConfigVersion((v) => v + 1);
  };
  const refreshConfig = async () => {
    try {
      applyConfig(await api("GET", "/config"));
    } catch (err) {
    }
  };
  const refreshRoster = async () => {
    try {
      const roster = await api("GET", "/editors");
      EDITORS_LIST.splice(0, EDITORS_LIST.length, ...roster.editors);
      setConfigVersion((v) => v + 1);
    } catch (err) {
    }
  };
  const showAlert = (title, message, type = "info") => {
    setModal({ isOpen: true, title, message, type });
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [config, roster, session] = await Promise.all([
          api("GET", "/config"),
          api("GET", "/editors"),
          api("GET", "/auth/me")
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
    return () => {
      cancelled = true;
    };
  }, []);
  const refreshOrders = async () => {
    const startedAt = Date.now();
    try {
      const data = await api("GET", "/orders");
      if (lastLocalChange.current > startedAt) return;
      setOrders((prev) => JSON.stringify(prev) === JSON.stringify(data.orders) ? prev : data.orders);
    } catch (err) {
    }
  };
  const upsertOrder = (order) => {
    lastLocalChange.current = Date.now();
    setOrders((prev) => prev.some((o) => o.id === order.id) ? prev.map((o) => o.id === order.id ? order : o) : [order, ...prev]);
  };
  const userKey = currentUser ? `${currentUser.role}:${currentUser.email}` : "";
  useEffect(() => {
    if (ready) refreshConfig();
    if (!userKey) {
      setOrders([]);
      return;
    }
    refreshOrders();
    const timer = setInterval(() => {
      if (!document.hidden) refreshOrders();
    }, 5e3);
    return () => clearInterval(timer);
  }, [userKey, ready]);
  useEffect(() => {
    const onUnauthorized = () => {
      setCurrentUser((prev) => {
        if (prev) showAlert("Session Expired", "Please sign in again to continue.", "info");
        return null;
      });
    };
    window.addEventListener("lz-unauthorized", onUnauthorized);
    return () => window.removeEventListener("lz-unauthorized", onUnauthorized);
  }, []);
  useEffect(() => {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  });
  const handleLogout = async () => {
    try {
      await api("POST", "/auth/logout");
    } catch (err) {
    }
    setCurrentUser(null);
    setOrders([]);
    showAlert("Signed Out", "You have been safely signed out from Lilizzh Studio.", "info");
  };
  const handleRegistered = (user) => {
    setCurrentUser(user);
    setLoginModalOpen(false);
    showAlert("Account Created!", `Welcome to Lilizzh Studio, ${user.name}! Your workspace is ready.`, "success");
  };
  if (!ready) {
    return /* @__PURE__ */ React.createElement("div", { className: "min-h-screen bg-obsidian text-gray-400 flex items-center justify-center font-mono text-xs px-6 text-center" }, loadError || "");
  }
  return /* @__PURE__ */ React.createElement("div", { className: "min-h-screen bg-obsidian text-gray-100 flex flex-col font-sans relative" }, /* @__PURE__ */ React.createElement("header", { className: "sticky top-0 z-40 glass-panel border-b border-white/10 px-4 md:px-8 py-3.5 flex items-center justify-between" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3.5" }, /* @__PURE__ */ React.createElement("div", { className: "w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-emerald-400 p-0.5 flex items-center justify-center glow-blue" }, /* @__PURE__ */ React.createElement("div", { className: "w-full h-full bg-obsidian rounded-[14px] flex items-center justify-center" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "video", className: "w-5 h-5 text-blue-400" }))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-lg font-black tracking-tight bg-gradient-to-r from-white via-gray-200 to-blue-400 bg-clip-text text-transparent" }, "LILIZZH STUDIO"), /* @__PURE__ */ React.createElement("span", { className: "px-1.5 py-0.5 text-[9px] font-mono font-bold bg-blue-500/20 text-blue-400 rounded-md border border-blue-500/30" }, "v6.0")), /* @__PURE__ */ React.createElement("span", { className: "block text-[10px] font-mono tracking-widest text-emerald-400 uppercase" }, "Unified Multi-Editor Cloud Platform"))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-4 md:space-x-6" }, /* @__PURE__ */ React.createElement("div", { className: "hidden xl:flex items-center space-x-3 text-xs font-mono" }, /* @__PURE__ */ React.createElement(
    "a",
    {
      href: "https://lileshwar12.github.io/LilizZh-Freelancing/",
      target: "_blank",
      rel: "noopener noreferrer",
      className: "px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 flex items-center space-x-1.5 transition-all"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "external-link", className: "w-3.5 h-3.5 text-blue-400" }),
    /* @__PURE__ */ React.createElement("span", null, "Sample Page")
  ), /* @__PURE__ */ React.createElement(
    "a",
    {
      href: "https://lileshwar12.github.io/lilizzh.studio",
      target: "_blank",
      rel: "noopener noreferrer",
      className: "px-3 py-1.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center space-x-1.5 transition-all"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "sparkles", className: "w-3.5 h-3.5 text-purple-400" }),
    /* @__PURE__ */ React.createElement("span", null, "Big Projects Studio")
  )), /* @__PURE__ */ React.createElement("div", { className: "hidden lg:flex items-center space-x-4 text-xs font-mono text-gray-400 border-l border-white/10 pl-4" }, /* @__PURE__ */ React.createElement(ContactLinks, { onSignIn: () => setLoginModalOpen(true) })), currentUser ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-2.5 bg-black/60 p-1.5 rounded-2xl border border-white/10" }, /* @__PURE__ */ React.createElement("div", { className: "px-3 py-1 rounded-xl bg-white/5 text-xs font-mono flex items-center space-x-2" }, /* @__PURE__ */ React.createElement("span", { className: `w-2 h-2 rounded-full ${currentUser.role === "ADMIN" ? "bg-emerald-400 animate-pulse" : currentUser.role === "EDITOR" ? "bg-purple-400" : "bg-blue-400"}` }), /* @__PURE__ */ React.createElement("span", { className: "font-bold text-white max-w-[120px] truncate" }, currentUser.name), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 font-mono hidden sm:inline" }, "[", currentUser.role, "]")), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: handleLogout,
      className: "p-2 sm:px-3 sm:py-1 rounded-xl bg-red-500/10 hover:bg-red-500/25 text-red-400 text-xs font-semibold transition-all border border-red-500/20 flex items-center space-x-1",
      title: "Sign Out"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "log-out", className: "w-3.5 h-3.5" }),
    /* @__PURE__ */ React.createElement("span", { className: "hidden sm:inline" }, "Logout")
  )) : /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setLoginModalOpen(true),
      className: "px-5 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-500/30 flex items-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "user-check", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "Portal Access")
  ))), /* @__PURE__ */ React.createElement("main", { className: "flex-1" }, !currentUser || currentUser.role === "CLIENT" ? /* @__PURE__ */ React.createElement(
    ClientPortal,
    {
      orders,
      onOrder: upsertOrder,
      showAlert,
      currentUser,
      openLoginModal: () => setLoginModalOpen(true)
    }
  ) : currentUser.role === "EDITOR" ? /* @__PURE__ */ React.createElement(
    EditorWorkspace,
    {
      orders,
      onOrder: upsertOrder,
      showAlert,
      currentUser
    }
  ) : /* @__PURE__ */ React.createElement(
    AdminDashboard,
    {
      orders,
      onOrder: upsertOrder,
      showAlert,
      currentUser,
      onRosterChange: refreshRoster,
      onConfigChange: refreshConfig
    }
  )), loginModalOpen && /* @__PURE__ */ React.createElement(
    AuthModal,
    {
      isOpen: loginModalOpen,
      onClose: () => setLoginModalOpen(false),
      onRegisterSuccess: handleRegistered,
      onLoginSuccess: (user) => {
        setCurrentUser(user);
        setLoginModalOpen(false);
        showAlert("Welcome Back!", `Logged in successfully as ${user.name} [${user.role} Portal]`, "success");
      },
      showAlert
    }
  ), /* @__PURE__ */ React.createElement("footer", { className: "glass-panel border-t border-white/10 py-10 px-6 text-xs text-gray-500" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3" }, /* @__PURE__ */ React.createElement("div", { className: "w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold" }, "L"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", null, "\xA9 2026-2030. Permanent Cloud Storage Vault & Multi-Editor Hub."))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center justify-center gap-6 text-gray-400 font-mono text-[11px]" }, /* @__PURE__ */ React.createElement("a", { href: "https://lileshwar12.github.io/LilizZh-Freelancing/", target: "_blank", rel: "noreferrer", className: "hover:text-white transition-colors" }, "Sample Portfolio"), /* @__PURE__ */ React.createElement("a", { href: "https://lileshwar12.github.io/lilizzh.studio", target: "_blank", rel: "noreferrer", className: "hover:text-purple-400 transition-colors" }, "Big Projects Studio"), /* @__PURE__ */ React.createElement(ContactLinks, null)))), /* @__PURE__ */ React.createElement(
    CustomModal,
    {
      isOpen: modal.isOpen,
      title: modal.title,
      message: modal.message,
      type: modal.type,
      onClose: () => setModal({ ...modal, isOpen: false })
    }
  ));
}
function AuthModal({ isOpen, onClose, onRegisterSuccess, onLoginSuccess, showAlert }) {
  const [authMode, setAuthMode] = useState("client_login");
  const [clientLoginType, setClientLoginType] = useState("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [selectedEditorId, setSelectedEditorId] = useState(EDITORS_LIST[0] ? EDITORS_LIST[0].id : "ed-1");
  const [submitting, setSubmitting] = useState(false);
  if (!isOpen) return null;
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const failTitle = authMode === "admin_login" ? "Admin Login Failed" : authMode === "editor_login" ? "Editor Sign-In Failed" : authMode === "client_signup" ? "Sign Up Failed" : "Sign In Failed";
    if (authMode === "client_signup" && (!name.trim() || !email.trim() || !phone.trim() || !password)) {
      showAlert("Input Required", "Please complete all registration fields.", "info");
      return;
    }
    if (authMode === "client_login" && !password) {
      showAlert("Input Required", "Please enter your password.", "info");
      return;
    }
    setSubmitting(true);
    try {
      if (authMode === "client_signup") {
        const data2 = await api("POST", "/auth/register", {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          password
        });
        onRegisterSuccess(data2.user);
        return;
      }
      let payload;
      if (authMode === "admin_login") {
        payload = { role: "ADMIN", email: email.trim(), password };
      } else if (authMode === "editor_login") {
        payload = { role: "EDITOR", editorId: selectedEditorId, password };
      } else {
        payload = {
          role: "CLIENT",
          password,
          ...clientLoginType === "email" ? { email: email.trim() } : { phone: phone.trim() }
        };
      }
      const data = await api("POST", "/auth/login", payload);
      onLoginSuccess(data.user);
    } catch (err) {
      showAlert(failTitle, err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };
  return /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel max-w-md w-full p-8 rounded-3xl border border-white/10 space-y-6 glow-blue relative" }, /* @__PURE__ */ React.createElement("button", { onClick: onClose, className: "absolute top-6 right-6 text-gray-400 hover:text-white transition-colors" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "x", className: "w-5 h-5" })), /* @__PURE__ */ React.createElement("div", { className: "text-center space-y-1.5" }, /* @__PURE__ */ React.createElement("div", { className: "inline-flex p-3 rounded-2xl bg-blue-500/10 text-blue-400 mb-1" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": authMode === "admin_login" ? "shield-check" : authMode === "editor_login" ? "scissors" : "user", className: "w-6 h-6" })), /* @__PURE__ */ React.createElement("h3", { className: "text-2xl font-bold text-white" }, authMode === "admin_login" ? "Studio Staff Admin" : authMode === "editor_login" ? "Editor Portal" : authMode === "client_signup" ? "Create Client Account" : "Client Sign In"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400" }, authMode === "editor_login" ? "Access your private queue, client folders & draft uploader" : authMode === "admin_login" ? "Financial verification, order dispatch & render release" : "Access your cloud media vault and production workspace")), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-black/50 border border-white/10 text-xs font-mono" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        setAuthMode("client_login");
        setPassword("");
      },
      className: `py-2 rounded-xl transition-all ${authMode.startsWith("client") ? "bg-blue-600 text-white font-bold shadow-md" : "text-gray-400 hover:text-white"}`
    },
    "Client"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        setAuthMode("editor_login");
        setPassword("");
      },
      className: `py-2 rounded-xl transition-all ${authMode === "editor_login" ? "bg-purple-600 text-white font-bold shadow-md" : "text-gray-400 hover:text-white"}`
    },
    "Editor"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        setAuthMode("admin_login");
        setEmail("");
        setPassword("");
      },
      className: `py-2 rounded-xl transition-all ${authMode === "admin_login" ? "bg-emerald-600 text-white font-bold shadow-md" : "text-gray-400 hover:text-white"}`
    },
    "Admin"
  )), authMode === "client_login" && /* @__PURE__ */ React.createElement("div", { className: "flex bg-black/40 p-1 rounded-xl border border-white/5 text-[11px] font-mono" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setClientLoginType("email"),
      className: `flex-1 py-1.5 rounded-lg transition-all ${clientLoginType === "email" ? "bg-white/10 text-white font-bold" : "text-gray-400 hover:text-white"}`
    },
    "Login via Email"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setClientLoginType("phone"),
      className: `flex-1 py-1.5 rounded-lg transition-all ${clientLoginType === "phone" ? "bg-white/10 text-white font-bold" : "text-gray-400 hover:text-white"}`
    },
    "Login via Phone"
  )), /* @__PURE__ */ React.createElement("form", { onSubmit: handleSubmit, className: "space-y-4 font-sans text-xs" }, authMode === "client_signup" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "Full Name *"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      required: true,
      placeholder: "e.g. Alex Rivers",
      value: name,
      onChange: (e) => setName(e.target.value),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "WhatsApp / Contact Phone *"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "tel",
      required: true,
      placeholder: "+91 9876543210",
      value: phone,
      onChange: (e) => setPhone(e.target.value),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "Email Address *"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "email",
      required: true,
      placeholder: "alex@creator.io",
      value: email,
      onChange: (e) => setEmail(e.target.value),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
    }
  ))), authMode === "client_login" && /* @__PURE__ */ React.createElement(React.Fragment, null, clientLoginType === "email" ? /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "Registered Email *"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "email",
      required: true,
      placeholder: "alex@creator.io",
      value: email,
      onChange: (e) => setEmail(e.target.value),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
    }
  )) : /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "Registered Phone Number *"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "tel",
      required: true,
      placeholder: "+91 9876543210",
      value: phone,
      onChange: (e) => setPhone(e.target.value),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
    }
  ))), authMode === "editor_login" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "Select Editor Profile *"), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: selectedEditorId,
      onChange: (e) => {
        const id = e.target.value;
        setSelectedEditorId(id);
        setPassword("");
      },
      className: "w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
    },
    EDITORS_LIST.map((ed) => /* @__PURE__ */ React.createElement("option", { key: ed.id, value: ed.id }, ed.name, " \u2014 ", ed.role))
  )), authMode === "admin_login" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "Admin Email Address *"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "email",
      required: true,
      placeholder: "Admin login email",
      value: email,
      onChange: (e) => setEmail(e.target.value),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 font-mono"
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, authMode === "editor_login" ? "Editor Security Passcode *" : "Password *"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "password",
      required: true,
      placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
      value: password,
      onChange: (e) => setPassword(e.target.value),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
    }
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "submit",
      className: `w-full py-3.5 rounded-2xl text-white font-bold text-xs transition-all shadow-lg flex items-center justify-center space-x-2 ${authMode === "editor_login" ? "bg-purple-600 hover:bg-purple-500 shadow-purple-500/30" : authMode === "admin_login" ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/30" : "bg-blue-600 hover:bg-blue-500 shadow-blue-500/30"}`
    },
    /* @__PURE__ */ React.createElement("span", null, authMode === "client_signup" ? "Create Account & Open Portal" : authMode === "editor_login" ? "Launch Editor Workspace" : authMode === "admin_login" ? "Enter Management Console" : "Sign In to Workspace"),
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "arrow-right", className: "w-4 h-4" })
  )), authMode.startsWith("client") && /* @__PURE__ */ React.createElement("div", { className: "pt-3 border-t border-white/10 text-center" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setAuthMode(authMode === "client_login" ? "client_signup" : "client_login"),
      className: "text-xs text-blue-400 hover:text-blue-300 font-mono transition-colors"
    },
    authMode === "client_login" ? "New client? Create your secure account" : "Already registered? Sign in"
  ))));
}
function ClientPortal({ orders, onOrder, showAlert, currentUser, openLoginModal }) {
  var _a, _b;
  const [activeTab, setActiveTab] = useState("explore");
  const [filterCategory, setFilterCategory] = useState("All");
  const [selectedEditor, setSelectedEditor] = useState(null);
  const [portfolioModalEditor, setPortfolioModalEditor] = useState(null);
  const [isBriefModalOpen, setIsBriefModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [negotiateModalOpen, setNegotiateModalOpen] = useState(false);
  const [rateCardModalOpen, setRateCardModalOpen] = useState(false);
  const [utrNumber, setUtrNumber] = useState("");
  const [previewFile, setPreviewFile] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState("Raw Footage");
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [newMessage, setNewMessage] = useState("");
  const [briefData, setBriefData] = useState({
    projectType: "Long video",
    aspectRatio: "16:9 Landscape",
    phone: (currentUser == null ? void 0 : currentUser.phone) || "",
    notes: "",
    budgetOffer: 160
  });
  const [negotiationInput, setNegotiationInput] = useState({
    proposedPrice: "",
    note: ""
  });
  const myOrders = currentUser ? orders.filter((o) => o.clientEmail.toLowerCase() === currentUser.email.toLowerCase()) : orders;
  const [activeOrderId, setActiveOrderId] = useState(((_a = myOrders[0]) == null ? void 0 : _a.id) || "");
  useEffect(() => {
    if (myOrders.length > 0 && !myOrders.some((o) => o.id === activeOrderId)) {
      setActiveOrderId(myOrders[0].id);
    }
  }, [myOrders]);
  const currentOrder = myOrders.find((o) => o.id === activeOrderId) || myOrders[0];
  const currentFolders = (currentOrder == null ? void 0 : currentOrder.folders) || ["Raw Footage", "Audio & Music", "Graphics & B-Roll"];
  const currentFiles = ((currentOrder == null ? void 0 : currentOrder.uploadedFiles) || []).filter((f) => (f.folder || "Raw Footage") === selectedFolder);
  const handleProjectTypeChange = (type) => {
    const matched = RATE_CARD.find((r) => r.type === type);
    setBriefData({
      ...briefData,
      projectType: type,
      budgetOffer: matched ? matched.clientPriceDefault : 160
    });
  };
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
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
      particles.forEach((p) => {
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
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ringAngle += 7e-3;
      ctx.rotate(ringAngle);
      ctx.strokeStyle = "rgba(59, 130, 246, 0.22)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, 150, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(16, 185, 129, 0.18)";
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
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);
  const filteredEditors = filterCategory === "All" ? EDITORS_LIST : EDITORS_LIST.filter((ed) => ed.tag.toLowerCase() === filterCategory.toLowerCase());
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
  const showMargins = RATE_CARD.some((r) => r.editorPayoutRangeUSD);
  const failWith = (title) => (err) => showAlert(title, err.message, "error");
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [paymentInfoError, setPaymentInfoError] = useState("");
  useEffect(() => {
    if (!paymentModalOpen || !currentOrder) return;
    let cancelled = false;
    setPaymentInfo(null);
    setPaymentInfoError("");
    api("GET", `/orders/${currentOrder.id}/payment-info`).then((info) => {
      if (!cancelled) setPaymentInfo(info);
    }).catch((err) => {
      if (!cancelled) setPaymentInfoError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [paymentModalOpen, currentOrder ? currentOrder.id : ""]);
  const submitBrief = async (e) => {
    e.preventDefault();
    const matchedRate = RATE_CARD.find((r) => r.type === briefData.projectType);
    try {
      const { order } = await api("POST", "/orders", {
        editorId: selectedEditor ? selectedEditor.id : null,
        projectType: briefData.projectType,
        aspectRatio: briefData.aspectRatio,
        phone: briefData.phone || currentUser.phone || "",
        notes: briefData.notes || "Full standard edit with cinematic grading.",
        budgetOffer: Number(briefData.budgetOffer) || (matchedRate ? matchedRate.clientPriceDefault : 160)
      });
      onOrder(order);
      setActiveOrderId(order.id);
      setIsBriefModalOpen(false);
      setActiveTab("workspace");
      showAlert("Project Initialized!", `Order ${order.id} initialized. Assigned to ${order.editor} with cloud vault unlocked.`, "success");
    } catch (err) {
      failWith("Could Not Create Project")(err);
    }
  };
  const handleNegotiationSubmit = async (e) => {
    e.preventDefault();
    if (!currentOrder || !negotiationInput.proposedPrice) return;
    const propPrice = Number(negotiationInput.proposedPrice);
    if (propPrice <= 0) {
      showAlert("Invalid Amount", "Please propose a positive price in USD.", "error");
      return;
    }
    try {
      const { order } = await api("POST", `/orders/${currentOrder.id}/negotiation`, {
        proposedPrice: propPrice,
        note: negotiationInput.note
      });
      onOrder(order);
      setNegotiateModalOpen(false);
      setNegotiationInput({ proposedPrice: "", note: "" });
      showAlert("Offer Submitted!", `Your proposed price of $${propPrice} USD has been sent to Admin. You will receive an update shortly!`, "success");
    } catch (err) {
      failWith("Offer Not Sent")(err);
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
      showAlert("Asset Vaulted!", `"${file.name}" permanently secured under directory [${selectedFolder}].`, "success");
    } catch (err) {
      failWith("Upload Failed")(err);
    } finally {
      setIsUploading(false);
      input.value = "";
    }
  };
  const handleDeleteFile = async (fileObj) => {
    if (!currentOrder) return;
    try {
      const { order } = await api("DELETE", `/orders/${currentOrder.id}/files/${encodeURIComponent(fileObj.id)}`);
      onOrder(order);
      showAlert("File Removed", `File "${fileObj.name}" deleted from cloud vault.`, "info");
    } catch (err) {
      failWith("Could Not Delete File")(err);
    }
  };
  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim() || !currentOrder) return;
    const name = newFolderName.trim();
    const existing = currentOrder.folders || ["Raw Footage"];
    if (existing.includes(name)) {
      showAlert("Folder Exists", "A folder with this name already exists.", "info");
      return;
    }
    try {
      const { order } = await api("POST", `/orders/${currentOrder.id}/folders`, { name });
      onOrder(order);
      setSelectedFolder(name);
      setNewFolderName("");
      setIsCreatingFolder(false);
      showAlert("Folder Created", `New vault directory "${name}" created.`, "success");
    } catch (err) {
      failWith("Could Not Create Folder")(err);
    }
  };
  const handleDeleteFolder = async (folderName) => {
    if (folderName === "Raw Footage") {
      showAlert("Protected Directory", 'The default "Raw Footage" directory cannot be deleted.', "info");
      return;
    }
    try {
      const { order } = await api("DELETE", `/orders/${currentOrder.id}/folders?name=${encodeURIComponent(folderName)}`);
      onOrder(order);
      setSelectedFolder("Raw Footage");
      showAlert("Directory Removed", `Folder "${folderName}" deleted. Associated files safely moved to Raw Footage.`, "info");
    } catch (err) {
      failWith("Could Not Delete Folder")(err);
    }
  };
  const handleDownloadFile = (fileObj) => {
    const a = document.createElement("a");
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
      const { order } = await api("POST", `/orders/${currentOrder.id}/payment-proof`, { utr: utrNumber.trim() });
      onOrder(order);
      setPaymentModalOpen(false);
      setUtrNumber("");
      showAlert("Payment Ref Registered!", "UTR reference registered. Lead Staff will verify the bank transaction and unlock your clean 4K master.", "success");
    } catch (err) {
      failWith("Payment Reference Not Saved")(err);
    }
  };
  const [privateChat, setPrivateChat] = useState(false);
  const sendChatMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentOrder) return;
    const text = newMessage.trim();
    setNewMessage("");
    try {
      const { order } = await api("POST", `/orders/${currentOrder.id}/messages`, { text, private: privateChat });
      onOrder(order);
    } catch (err) {
      setNewMessage(text);
      failWith("Message Not Sent")(err);
    }
  };
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-12 pb-20" }, /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-4 sm:px-6 pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-2 bg-black/50 p-1.5 rounded-2xl border border-white/10 self-start sm:self-auto" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setActiveTab("explore"),
      className: `px-5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center space-x-2 ${activeTab === "explore" ? "bg-blue-600 text-white font-bold shadow-lg shadow-blue-500/25" : "text-gray-400 hover:text-white"}`
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "compass", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "Portfolio & Editors")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        if (!currentUser) openLoginModal();
        else setActiveTab("workspace");
      },
      className: `px-5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center space-x-2 ${activeTab === "workspace" ? "bg-blue-600 text-white font-bold shadow-lg shadow-blue-500/25" : "text-gray-400 hover:text-white"}`
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "hard-drive", className: "w-4 h-4 text-emerald-400" }),
    /* @__PURE__ */ React.createElement("span", null, "Cloud Workspace & Vault"),
    myOrders.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "px-2 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded-full font-mono font-bold" }, myOrders.length)
  )), /* @__PURE__ */ React.createElement("div", { className: "hidden md:flex items-center space-x-3 text-xs font-mono text-gray-400" }, /* @__PURE__ */ React.createElement("span", null, "Message the studio:"), /* @__PURE__ */ React.createElement(ContactLinks, null))), activeTab === "explore" ? /* @__PURE__ */ React.createElement("div", { className: "space-y-20" }, /* @__PURE__ */ React.createElement("section", { className: "relative min-h-[75vh] flex items-center justify-center overflow-hidden px-4 md:px-6" }, /* @__PURE__ */ React.createElement("div", { className: "absolute inset-0 z-0" }, /* @__PURE__ */ React.createElement("canvas", { ref: canvasRef, className: "w-full h-full opacity-80" }), /* @__PURE__ */ React.createElement("div", { className: "absolute inset-0 bg-gradient-to-b from-transparent via-obsidian/80 to-obsidian" })), /* @__PURE__ */ React.createElement("div", { className: "relative z-10 max-w-4xl mx-auto text-center space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "inline-flex items-center space-x-2 px-4 py-2 rounded-full glass-panel border border-blue-500/30 text-blue-400 text-xs font-mono uppercase tracking-widest glow-blue" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "sparkles", className: "w-3.5 h-3.5" }), /* @__PURE__ */ React.createElement("span", null, "Lilizzh Studio v6.0 \u2022 Multi-Editor Hub & Transparent Rate Card")), /* @__PURE__ */ React.createElement("h1", { className: "text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white leading-tight" }, "Turn Raw Footage Into ", /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("span", { className: "bg-gradient-to-r from-blue-400 via-emerald-400 to-purple-400 bg-clip-text text-transparent" }, "High-Converting 4K Cinema")), /* @__PURE__ */ React.createElement("p", { className: "text-base sm:text-lg text-gray-300 max-w-2xl mx-auto leading-relaxed" }, "Seamless client-to-editor pipelines with flexible pricing & negotiation: Short/Reels, 10x Batches, and Long Documentary Master cuts."), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col sm:flex-row items-center justify-center gap-4 pt-2" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        const el = document.getElementById("marketplace");
        if (el) el.scrollIntoView({ behavior: "smooth" });
      },
      className: "w-full sm:w-auto px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-xl shadow-blue-500/30 flex items-center justify-center space-x-3 group"
    },
    /* @__PURE__ */ React.createElement("span", null, "Hire Dedicated Editor"),
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "arrow-right", className: "w-4 h-4 group-hover:translate-x-1 transition-transform" })
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        const el = document.getElementById("rate-card-section");
        if (el) el.scrollIntoView({ behavior: "smooth" });
        else setRateCardModalOpen(true);
      },
      className: "w-full sm:w-auto px-8 py-4 rounded-2xl glass-panel hover:bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "receipt", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "View Rate Card & Margins")
  )))), /* @__PURE__ */ React.createElement("section", { id: "marketplace", className: "max-w-7xl mx-auto px-4 md:px-6 space-y-10" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/10 pb-6" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-mono tracking-widest text-emerald-400 uppercase" }, "Expert Roster"), /* @__PURE__ */ React.createElement("h2", { className: "text-3xl font-extrabold text-white mt-1" }, "Choose Your Dedicated Editor"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-1" }, "Every project is assigned to a dedicated professional with direct real-time communication.")), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2" }, ["All", "YouTube", "Shorts", "Documentary", "Ads"].map((cat) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: cat,
      onClick: () => setFilterCategory(cat),
      className: `px-4 py-2 rounded-xl text-xs font-medium transition-all ${filterCategory === cat ? "bg-blue-600 text-white font-bold shadow-lg shadow-blue-500/25" : "glass-panel text-gray-400 hover:text-white border border-white/10"}`
    },
    cat
  )))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6" }, filteredEditors.map((editor) => /* @__PURE__ */ React.createElement("div", { key: editor.id, className: "glass-card p-6 rounded-3xl flex flex-col justify-between space-y-6 relative overflow-hidden group" }, /* @__PURE__ */ React.createElement("div", { className: "absolute top-4 right-4 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-mono font-bold" }, editor.badge), /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "w-20 h-20 rounded-2xl overflow-hidden border-2 border-white/10 group-hover:border-blue-500/50 transition-colors" }, /* @__PURE__ */ React.createElement("img", { src: editor.avatar, alt: editor.name, className: "w-full h-full object-cover" })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "text-lg font-bold text-white" }, editor.name), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-0.5" }, editor.role)), /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3 text-xs font-mono text-gray-400" }, /* @__PURE__ */ React.createElement("span", { className: "text-amber-400 font-bold flex items-center space-x-1" }, /* @__PURE__ */ React.createElement("span", null, "\u2605"), /* @__PURE__ */ React.createElement("span", null, editor.rating)), /* @__PURE__ */ React.createElement("span", null, "\u2022"), /* @__PURE__ */ React.createElement("span", null, "Turnaround: ", /* @__PURE__ */ React.createElement("strong", { className: "text-white" }, editor.speed)))), /* @__PURE__ */ React.createElement("div", { className: "space-y-2 pt-2" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setPortfolioModalEditor(editor),
      className: "w-full py-2.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-semibold text-xs transition-all border border-blue-500/20 flex items-center justify-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "play-circle", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "View Portfolio & Reel")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => handleHireClick(editor),
      className: "w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("span", null, "Hire ", editor.name.split(" ")[0]),
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "arrow-right", className: "w-3.5 h-3.5" })
  )))))), /* @__PURE__ */ React.createElement("section", { id: "rate-card-section", className: "max-w-7xl mx-auto px-4 md:px-6" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 sm:p-8 rounded-3xl border border-white/10 glow-blue space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col md:flex-row md:items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-mono text-emerald-400 uppercase tracking-widest font-bold" }, "Standard Pricing & Negotiation"), /* @__PURE__ */ React.createElement("h2", { className: "text-2xl md:text-3xl font-extrabold text-white mt-1" }, "Video Editing Rate Card"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-0.5" }, "Transparent rates based on production scale. Clients can propose budget negotiations on any tier.")), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setRateCardModalOpen(true),
      className: "px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-blue-400 border border-blue-500/30 self-start md:self-auto flex items-center space-x-1.5"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "info", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "Detailed Breakdown")
  )), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-6 pt-2" }, RATE_CARD.map((rate) => /* @__PURE__ */ React.createElement("div", { key: rate.id, className: "glass-card p-6 rounded-2xl border border-white/10 flex flex-col justify-between space-y-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 font-mono text-[10px] font-bold uppercase" }, rate.typicalTurnaround), /* @__PURE__ */ React.createElement("h3", { className: "text-lg font-bold text-white mt-3" }, rate.type), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-1 leading-relaxed" }, rate.description)), /* @__PURE__ */ React.createElement("div", { className: "space-y-2 pt-2 border-t border-white/10" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-baseline" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs text-gray-400 font-mono" }, "Client Standard:"), /* @__PURE__ */ React.createElement("span", { className: "text-base font-bold text-emerald-400 font-mono" }, rate.clientPriceRangeUSD)), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center text-[11px] font-mono text-gray-400" }, /* @__PURE__ */ React.createElement("span", null, "INR Range:"), /* @__PURE__ */ React.createElement("span", { className: "text-white font-semibold" }, rate.clientPriceRangeINR))), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => handleHireClick(null, rate.type),
      className: "w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-md flex items-center justify-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("span", null, "Order ", rate.type),
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "arrow-right", className: "w-3.5 h-3.5" })
  )))), /* @__PURE__ */ React.createElement("div", { className: "pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 bg-black/40 p-5 rounded-2xl border border-emerald-500/20" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3.5" }, /* @__PURE__ */ React.createElement("div", { className: "p-3 rounded-2xl bg-emerald-500/20 text-emerald-400" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "calculator", className: "w-6 h-6" })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h4", { className: "text-sm font-bold text-white" }, "Custom Volume or Unique Requirements?"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400" }, showMargins ? "Explore full profit splits, editor allocations, or propose your custom budget." : "Explore the full pricing matrix or propose your custom budget."))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-3 w-full sm:w-auto" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setRateCardModalOpen(true),
      className: "flex-1 sm:flex-none px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "receipt", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "View Full Pricing Matrix")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => handleHireClick(null, "Long video"),
      className: "flex-1 sm:flex-none px-6 py-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "scale", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "Negotiate Custom Budget")
  ))))), /* @__PURE__ */ React.createElement("section", { className: "max-w-7xl mx-auto px-4 md:px-6 space-y-8" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-8 rounded-3xl border border-white/10 space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col md:flex-row md:items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-mono text-blue-400 font-bold uppercase tracking-wider" }, "Lead Technologist & Director"), /* @__PURE__ */ React.createElement("h2", { className: "text-2xl md:text-3xl font-extrabold text-white mt-1" }, "Lilesh Pravin Patil"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-1" }, "Creative Technologist building products at the intersection of software logic, AI automation, and cinematic video post-production.")), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-3" }, /* @__PURE__ */ React.createElement(
    "a",
    {
      href: "https://lileshwar12.github.io/LilizZh-Freelancing/",
      target: "_blank",
      rel: "noreferrer",
      className: "px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("span", null, "Freelancing Case Studies"),
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "external-link", className: "w-3.5 h-3.5" })
  ), /* @__PURE__ */ React.createElement(
    "a",
    {
      href: "https://lileshwar12.github.io/lilizzh.studio",
      target: "_blank",
      rel: "noreferrer",
      className: "px-4 py-2 rounded-xl bg-purple-600/30 hover:bg-purple-600 text-purple-300 hover:text-white border border-purple-500/40 font-bold text-xs flex items-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("span", null, "Big Projects Agency"),
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "sparkles", className: "w-3.5 h-3.5" })
  ))), /* @__PURE__ */ React.createElement("div", { className: "pt-4 border-t border-white/10" }, /* @__PURE__ */ React.createElement("h3", { className: "text-sm font-bold text-white font-mono uppercase tracking-wider mb-3" }, "Direct Inquire / Request Resume"), /* @__PURE__ */ React.createElement("form", { onSubmit: async (e) => {
    e.preventDefault();
    const form = e.target;
    const [nameInput, emailInput, phoneInput] = form.querySelectorAll("input");
    try {
      await api("POST", "/inquiries", {
        name: nameInput.value,
        email: emailInput.value,
        phone: phoneInput.value
      });
      showAlert("Inquiry Dispatched!", "Thank you! Your project inquiry has been forwarded to Lilesh Pravin Patil.", "success");
      form.reset();
    } catch (err) {
      showAlert("Inquiry Not Sent", err.message, "error");
    }
  }, className: "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs" }, /* @__PURE__ */ React.createElement("input", { type: "text", required: true, placeholder: "Your Name", className: "bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" }), /* @__PURE__ */ React.createElement("input", { type: "email", required: true, placeholder: "Your Email", className: "bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" }), /* @__PURE__ */ React.createElement("input", { type: "tel", placeholder: "WhatsApp / Contact", className: "bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" }), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "px-5 py-2.5 rounded-xl bg-white text-black font-bold text-xs hover:bg-gray-200 transition-colors" }, "Send Inquiry")))))) : (
    /* ========================================================
       CLIENT WORKSPACE & FILE VAULT WITH DUAL WATERMARK PLAYER
       ======================================================== */
    /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-4 md:px-6 space-y-8 animate-fadeIn" }, !currentOrder ? /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-12 rounded-3xl text-center space-y-6 border border-white/10" }, /* @__PURE__ */ React.createElement("div", { className: "w-16 h-16 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center mx-auto" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "folder-plus", className: "w-8 h-8" })), /* @__PURE__ */ React.createElement("h3", { className: "text-2xl font-bold text-white" }, "No Active Projects Yet"), /* @__PURE__ */ React.createElement("p", { className: "text-gray-400 text-sm max-w-md mx-auto" }, "Select a specialist editor from our curated roster to initialize your cloud storage vault."), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setActiveTab("explore"),
        className: "px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-500/25"
      },
      "Browse Editors"
    )) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3" }, /* @__PURE__ */ React.createElement("span", { className: "px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider" }, "Cloud Storage Vault \u2022 ", currentOrder.id), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-mono text-gray-400" }, "Account: ", (currentUser == null ? void 0 : currentUser.email) || currentOrder.clientEmail)), /* @__PURE__ */ React.createElement("h2", { className: "text-2xl font-extrabold text-white mt-2" }, currentOrder.projectType), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-1" }, "Assigned Editor: ", /* @__PURE__ */ React.createElement("strong", { className: "text-white" }, currentOrder.editor), " \u2022 Agreed Budget: ", /* @__PURE__ */ React.createElement("strong", { className: "text-emerald-400" }, "$", currentOrder.price, " USD"))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3" }, myOrders.length > 1 && /* @__PURE__ */ React.createElement(
      "select",
      {
        value: activeOrderId,
        onChange: (e) => setActiveOrderId(e.target.value),
        className: "bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
      },
      myOrders.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.id, value: o.id }, o.id, " - ", o.projectType))
    ), /* @__PURE__ */ React.createElement("span", { className: `px-4 py-2 rounded-xl text-xs font-bold font-mono ${currentOrder.unlocked ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/20 text-amber-400 border border-amber-500/30"}` }, currentOrder.unlocked ? "4K MASTER UNLOCKED" : "WATERMARKED PREVIEW DRAFT"))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-8" }, /* @__PURE__ */ React.createElement("div", { className: "lg:col-span-2 space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel rounded-3xl overflow-hidden border border-white/10 relative shadow-2xl" }, /* @__PURE__ */ React.createElement("div", { className: "relative aspect-video bg-black flex items-center justify-center" }, /* @__PURE__ */ React.createElement(
      "video",
      {
        controls: true,
        playsInline: true,
        className: "w-full h-full object-cover",
        src: currentOrder.unlocked ? currentOrder.cleanUrl : currentOrder.draftUrl
      }
    ), !currentOrder.unlocked && /* @__PURE__ */ React.createElement("div", { className: "absolute inset-0 pointer-events-none watermark-overlay opacity-60 flex items-center justify-center" }, /* @__PURE__ */ React.createElement("div", { className: "px-6 py-2.5 rounded-2xl bg-red-600/90 text-white font-mono text-xs md:text-sm font-black tracking-widest shadow-2xl backdrop-blur-md border border-red-400/50 animate-pulse uppercase" }, "LILIZZH STUDIO \u2014 UNPAID DRAFT PREVIEW ONLY"))), /* @__PURE__ */ React.createElement("div", { className: "p-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-black/50 border-t border-white/5" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h4", { className: "text-sm font-bold text-white flex items-center space-x-2" }, /* @__PURE__ */ React.createElement("span", null, "Current Cut Status:"), /* @__PURE__ */ React.createElement("span", { className: currentOrder.unlocked ? "text-emerald-400" : "text-amber-400" }, currentOrder.unlocked ? "Clean 4K Export Ready" : "Draft Preview Mode")), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-0.5" }, currentOrder.unlocked ? "Payment verified. You can now download the raw clean ProRes/MP4 4K master file." : `Pay current fee of $${currentOrder.price} USD (\u20B9${currentOrder.price * 86} INR) or propose a custom rate.`)), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap sm:flex-nowrap gap-2 shrink-0 w-full sm:w-auto" }, !currentOrder.unlocked && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          setNegotiationInput({
            proposedPrice: currentOrder.price,
            note: ""
          });
          setNegotiateModalOpen(true);
        },
        className: "flex-1 sm:flex-none px-4 py-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 font-bold text-xs transition-all flex items-center justify-center space-x-1.5"
      },
      /* @__PURE__ */ React.createElement("i", { "data-lucide": "scale", className: "w-4 h-4" }),
      /* @__PURE__ */ React.createElement("span", null, "Negotiate Price")
    ), !currentOrder.unlocked ? /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setPaymentModalOpen(true),
        className: "flex-1 sm:flex-none px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center space-x-2"
      },
      /* @__PURE__ */ React.createElement("i", { "data-lucide": "qr-code", className: "w-4 h-4" }),
      /* @__PURE__ */ React.createElement("span", null, "Pay $", currentOrder.price, " & Unlock 4K")
    ) : /* @__PURE__ */ React.createElement(
      "a",
      {
        href: currentOrder.cleanUrl,
        download: `${currentOrder.id}_Clean_4K_Master.mp4`,
        target: "_blank",
        rel: "noreferrer",
        className: "w-full sm:w-auto px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center space-x-2 shrink-0"
      },
      /* @__PURE__ */ React.createElement("i", { "data-lucide": "download", className: "w-4 h-4" }),
      /* @__PURE__ */ React.createElement("span", null, "Download 4K Clean Master (.mp4)")
    )))), currentOrder.negotiation && /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-4 rounded-2xl border border-purple-500/30 bg-purple-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono" }, /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-2 text-purple-300 font-bold" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "scale", className: "w-4 h-4" }), /* @__PURE__ */ React.createElement("span", null, "Negotiation In Progress"), /* @__PURE__ */ React.createElement("span", { className: "px-2 py-0.5 rounded-full text-[10px] bg-purple-500/20 border border-purple-500/40" }, currentOrder.negotiation.status)), /* @__PURE__ */ React.createElement("p", { className: "text-gray-300" }, "Proposed: ", /* @__PURE__ */ React.createElement("strong", { className: "text-white" }, "$", currentOrder.negotiation.proposedPrice, " USD (\u20B9", currentOrder.negotiation.proposedPrice * 86, " INR)"), ' \u2022 Note: "', currentOrder.negotiation.clientNote, '"')), /* @__PURE__ */ React.createElement("span", { className: "text-gray-400 text-[11px] shrink-0" }, "Awaiting Admin Response")), /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "text-lg font-bold text-white flex items-center space-x-2" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "hard-drive", className: "w-5 h-5 text-blue-400" }), /* @__PURE__ */ React.createElement("span", null, "Cloud Storage Vault")), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-0.5" }, "Upload raw footage, audio, and color assets into permanent folders.")), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setIsCreatingFolder(true),
        className: "px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono font-bold text-blue-400 border border-blue-500/30 flex items-center space-x-1.5 self-start sm:self-auto transition-all"
      },
      /* @__PURE__ */ React.createElement("i", { "data-lucide": "folder-plus", className: "w-4 h-4" }),
      /* @__PURE__ */ React.createElement("span", null, "New Folder")
    )), isCreatingFolder && /* @__PURE__ */ React.createElement("form", { onSubmit: handleCreateFolder, className: "flex items-center space-x-2 bg-black/50 p-3 rounded-2xl border border-blue-500/40 animate-fadeIn" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "folder", className: "w-4 h-4 text-blue-400" }), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        required: true,
        placeholder: "Folder Name (e.g. Color LUTs, Voiceovers, Drone Shots)...",
        value: newFolderName,
        onChange: (e) => setNewFolderName(e.target.value),
        className: "flex-1 bg-transparent text-xs text-white focus:outline-none font-mono"
      }
    ), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-bold" }, "Add"), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setIsCreatingFolder(false), className: "px-3 py-1.5 rounded-xl bg-white/5 text-gray-400 text-xs" }, "Cancel")), /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-2 overflow-x-auto pb-2" }, currentFolders.map((folder) => /* @__PURE__ */ React.createElement("div", { key: folder, className: "flex items-center group" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setSelectedFolder(folder),
        className: `px-4 py-2 rounded-xl text-xs font-mono font-semibold transition-all flex items-center space-x-2 whitespace-nowrap ${selectedFolder === folder ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20" : "bg-white/5 text-gray-400 hover:text-white border border-white/5"}`
      },
      /* @__PURE__ */ React.createElement("i", { "data-lucide": "folder", className: "w-3.5 h-3.5" }),
      /* @__PURE__ */ React.createElement("span", null, folder),
      /* @__PURE__ */ React.createElement("span", { className: "px-1.5 py-0.5 rounded-full bg-black/50 text-[10px]" }, (currentOrder.uploadedFiles || []).filter((f) => (f.folder || "Raw Footage") === folder).length)
    ), folder !== "Raw Footage" && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => handleDeleteFolder(folder),
        title: "Delete Folder",
        className: "p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
      },
      /* @__PURE__ */ React.createElement("i", { "data-lucide": "trash-2", className: "w-3.5 h-3.5" })
    )))), /* @__PURE__ */ React.createElement("label", { className: "border-2 border-dashed border-white/15 hover:border-blue-500/50 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all bg-white/[0.01]" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "upload-cloud", className: "w-8 h-8 text-blue-400 mb-2 animate-bounce" }), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-semibold text-white" }, "Click or Drop files to upload into [", selectedFolder, "]"), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 mt-1 font-mono" }, "Supported: MP4, MOV, WAV, PNG, LUT, ZIP, ProRes"), /* @__PURE__ */ React.createElement("input", { type: "file", className: "hidden", onChange: handleFileUpload })), isUploading && /* @__PURE__ */ React.createElement("div", { className: "space-y-2 bg-black/40 p-4 rounded-xl border border-white/10" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between text-xs font-mono" }, /* @__PURE__ */ React.createElement("span", { className: "text-blue-400" }, "Securing file to cloud storage..."), /* @__PURE__ */ React.createElement("span", { className: "text-white font-bold" }, uploadProgress, "%")), /* @__PURE__ */ React.createElement("div", { className: "w-full h-2 bg-white/10 rounded-full overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "h-full bg-blue-500 transition-all duration-200", style: { width: `${uploadProgress}%` } }))), /* @__PURE__ */ React.createElement("div", { className: "space-y-3 pt-2" }, /* @__PURE__ */ React.createElement("h4", { className: "text-xs font-mono text-gray-400 uppercase" }, "Files in [", selectedFolder, "] (", currentFiles.length, ")"), currentFiles.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "text-center py-8 text-gray-500 text-xs italic bg-white/[0.01] rounded-2xl border border-white/5" }, "No files uploaded in this directory yet. Upload raw takes above.") : /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, currentFiles.map((file) => /* @__PURE__ */ React.createElement("div", { key: file.id, className: "flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/10 hover:border-blue-500/30 transition-all text-xs font-mono" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3 overflow-hidden" }, /* @__PURE__ */ React.createElement("div", { className: "p-2 rounded-xl bg-blue-500/10 text-blue-400 shrink-0" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "file-video", className: "w-4 h-4" })), /* @__PURE__ */ React.createElement("div", { className: "truncate" }, /* @__PURE__ */ React.createElement("p", { className: "font-bold text-white truncate font-sans" }, file.name), /* @__PURE__ */ React.createElement("p", { className: "text-[10px] text-gray-400" }, file.size, " \u2022 Uploaded ", file.date))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-2 shrink-0" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setPreviewFile(file),
        className: "px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[11px] flex items-center space-x-1"
      },
      /* @__PURE__ */ React.createElement("i", { "data-lucide": "eye", className: "w-3.5 h-3.5" }),
      /* @__PURE__ */ React.createElement("span", null, "Preview")
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => handleDownloadFile(file),
        className: "px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white text-[11px] flex items-center space-x-1"
      },
      /* @__PURE__ */ React.createElement("i", { "data-lucide": "download", className: "w-3.5 h-3.5" }),
      /* @__PURE__ */ React.createElement("span", null, "Download")
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => handleDeleteFile(file),
        className: "p-1.5 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white transition-all",
        title: "Delete File"
      },
      /* @__PURE__ */ React.createElement("i", { "data-lucide": "trash-2", className: "w-3.5 h-3.5" })
    )))))))), /* @__PURE__ */ React.createElement("div", { className: "space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 flex flex-col h-[520px]" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between border-b border-white/10 pb-4 mb-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "text-sm font-bold text-white flex items-center space-x-2" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "message-square", className: "w-4 h-4 text-emerald-400" }), /* @__PURE__ */ React.createElement("span", null, "Editor Project Chat")), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 font-mono" }, "Assigned Editor: ", /* @__PURE__ */ React.createElement("strong", { className: "text-purple-400" }, currentOrder.editor))), /* @__PURE__ */ React.createElement("span", { className: "w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" })), /* @__PURE__ */ React.createElement("div", { className: "flex-1 overflow-y-auto space-y-3 pr-1 text-xs" }, (currentOrder.chatMessages || []).map((msg, idx) => /* @__PURE__ */ React.createElement("div", { key: idx, className: `flex flex-col ${msg.sender === "client" ? "items-end" : "items-start"}` }, /* @__PURE__ */ React.createElement("div", { className: `max-w-[85%] p-3 rounded-2xl leading-relaxed ${msg.sender === "client" ? "bg-blue-600 text-white rounded-br-none" : msg.sender === "system" ? "bg-white/5 border border-white/10 text-gray-300 w-full text-center font-mono text-[11px]" : "bg-purple-900/40 text-purple-200 border border-purple-500/30 rounded-bl-none"}` }, msg.private && msg.sender !== "system" && /* @__PURE__ */ React.createElement("i", { "data-lucide": "lock", className: "w-3 h-3 inline mr-1 opacity-70" }), msg.text), /* @__PURE__ */ React.createElement("span", { className: "text-[9px] text-gray-500 font-mono mt-1" }, msg.private ? "Private - studio owner only \xB7 " : "", msg.time)))), /* @__PURE__ */ React.createElement("label", { className: "mt-3 flex items-center space-x-2 text-[11px] font-mono text-gray-400 cursor-pointer select-none" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: privateChat, onChange: (e) => setPrivateChat(e.target.checked) }), /* @__PURE__ */ React.createElement("span", null, "Private message to the studio owner only (your editor will not see it)")), /* @__PURE__ */ React.createElement("form", { onSubmit: sendChatMessage, className: "mt-2 pt-3 border-t border-white/10 flex items-center space-x-2" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        placeholder: privateChat ? "Private note to the studio owner..." : "Type note to editor...",
        value: newMessage,
        onChange: (e) => setNewMessage(e.target.value),
        className: "flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 font-sans"
      }
    ), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "send", className: "w-4 h-4" })))), /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("h3", { className: "text-sm font-bold text-white font-mono uppercase tracking-wider" }, "Project Specifications"), /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setRateCardModalOpen(true),
        className: "text-[11px] text-blue-400 hover:underline font-mono"
      },
      "Rate Card"
    )), /* @__PURE__ */ React.createElement("div", { className: "space-y-2.5 text-xs font-mono text-gray-300" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between py-1 border-b border-white/5" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-500" }, "Project ID:"), /* @__PURE__ */ React.createElement("span", { className: "text-blue-400 font-bold" }, currentOrder.id)), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between py-1 border-b border-white/5" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-500" }, "Tier / Format:"), /* @__PURE__ */ React.createElement("span", { className: "text-white font-bold" }, currentOrder.projectType)), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between py-1 border-b border-white/5" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-500" }, "Editor:"), /* @__PURE__ */ React.createElement("span", { className: "text-purple-300" }, currentOrder.editor)), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between py-1 border-b border-white/5" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-500" }, "Status:"), /* @__PURE__ */ React.createElement("span", { className: "text-emerald-400 font-bold" }, currentOrder.status)), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between py-1" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-500" }, "Agreed Price:"), /* @__PURE__ */ React.createElement("span", { className: "text-emerald-400 font-bold text-sm" }, "$", currentOrder.price, " USD / \u20B9", currentOrder.price * 86, " INR"))), !currentOrder.unlocked && /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => {
          setNegotiationInput({
            proposedPrice: currentOrder.price,
            note: ""
          });
          setNegotiateModalOpen(true);
        },
        className: "w-full py-2.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 font-mono text-xs border border-purple-500/30 flex items-center justify-center space-x-2 transition-all"
      },
      /* @__PURE__ */ React.createElement("i", { "data-lucide": "scale", className: "w-3.5 h-3.5" }),
      /* @__PURE__ */ React.createElement("span", null, "Propose Counter-Offer")
    ), currentOrder.paymentProof && /* @__PURE__ */ React.createElement("div", { className: "p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-mono space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-1.5 text-emerald-400 font-bold" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "check-circle", className: "w-3.5 h-3.5" }), /* @__PURE__ */ React.createElement("span", null, "UTR Registered")), /* @__PURE__ */ React.createElement("p", { className: "text-gray-300" }, "Ref: ", /* @__PURE__ */ React.createElement("strong", null, currentOrder.paymentProof.utr)), /* @__PURE__ */ React.createElement("p", { className: "text-[10px] text-gray-400" }, "Status: ", currentOrder.paymentProof.status)))))))
  ), isBriefModalOpen && /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel max-w-lg w-full p-8 rounded-3xl border border-white/10 space-y-6 glow-blue relative max-h-[90vh] overflow-y-auto" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setIsBriefModalOpen(false), className: "absolute top-6 right-6 text-gray-400 hover:text-white" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "x", className: "w-5 h-5" })), /* @__PURE__ */ React.createElement("div", { className: "space-y-1" }, /* @__PURE__ */ React.createElement("h3", { className: "text-2xl font-bold text-white" }, "Project Initialization Brief"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400" }, "Assigning project to ", /* @__PURE__ */ React.createElement("strong", { className: "text-blue-400" }, (selectedEditor == null ? void 0 : selectedEditor.name) || "Lead Specialist"))), /* @__PURE__ */ React.createElement("form", { onSubmit: submitBrief, className: "space-y-4 font-sans text-xs" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center mb-1" }, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400" }, "Project Category & Rate Tier *"), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setRateCardModalOpen(true),
      className: "text-[10px] font-mono text-emerald-400 hover:underline"
    },
    "Rate Card Guide"
  )), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: briefData.projectType,
      onChange: (e) => handleProjectTypeChange(e.target.value),
      className: "w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 font-mono"
    },
    /* @__PURE__ */ React.createElement("option", { value: "Short / Reel" }, "Short / Reel ($25 - $35 / \u20B92,000 - \u20B92,900)"),
    /* @__PURE__ */ React.createElement("option", { value: "Batch of 10 Short / Reel" }, "Batch of 10 Short / Reel ($250 - $300 / \u20B921,000 - \u20B925,000)"),
    /* @__PURE__ */ React.createElement("option", { value: "Long video" }, "Long video ($120 - $200 / \u20B910,000 - \u20B916,000)")
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "Starting Budget Offer ($ USD) *"), /* @__PURE__ */ React.createElement("div", { className: "relative" }, /* @__PURE__ */ React.createElement("span", { className: "absolute left-4 top-3 text-gray-500 font-mono" }, "$"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      required: true,
      min: "10",
      value: briefData.budgetOffer,
      onChange: (e) => setBriefData({ ...briefData, budgetOffer: e.target.value }),
      className: "w-full bg-white/5 border border-white/10 rounded-xl pl-8 pr-4 py-3 text-white font-mono focus:outline-none focus:border-blue-500"
    }
  )), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 font-mono mt-1 block" }, "Approx. \u20B9", (Number(briefData.budgetOffer) || 0) * 86, " INR. You can also negotiate further with Admin after brief creation.")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "Target Aspect Ratio *"), /* @__PURE__ */ React.createElement(
    "select",
    {
      value: briefData.aspectRatio,
      onChange: (e) => setBriefData({ ...briefData, aspectRatio: e.target.value }),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
    },
    /* @__PURE__ */ React.createElement("option", { value: "16:9 Landscape" }, "16:9 Landscape (YouTube, TV, Cinema)"),
    /* @__PURE__ */ React.createElement("option", { value: "9:16 Vertical" }, "9:16 Vertical (TikTok, Instagram Reels, Shorts)"),
    /* @__PURE__ */ React.createElement("option", { value: "1:1 Square" }, "1:1 Square (Instagram Feed, LinkedIn)")
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "Contact Phone Number (WhatsApp updates) *"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "tel",
      required: true,
      placeholder: "+91 9876543210",
      value: briefData.phone,
      onChange: (e) => setBriefData({ ...briefData, phone: e.target.value }),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500"
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-400 block mb-1" }, "Creative Directives & References *"), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      rows: "3",
      required: true,
      placeholder: "Specify color grading preference, pacing, sound effects style, or paste reference links...",
      value: briefData.notes,
      onChange: (e) => setBriefData({ ...briefData, notes: e.target.value }),
      className: "w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white focus:outline-none focus:border-blue-500 resize-none font-sans"
    }
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "submit",
      className: "w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-xl shadow-blue-500/25 flex items-center justify-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("span", null, "Initialize Project & Open Cloud Vault"),
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "arrow-right", className: "w-4 h-4" })
  )))), negotiateModalOpen && currentOrder && /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel max-w-md w-full p-8 rounded-3xl border border-purple-500/30 space-y-6 glow-purple relative" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setNegotiateModalOpen(false), className: "absolute top-6 right-6 text-gray-400 hover:text-white" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "x", className: "w-5 h-5" })), /* @__PURE__ */ React.createElement("div", { className: "space-y-1.5 text-center" }, /* @__PURE__ */ React.createElement("div", { className: "inline-flex p-3 rounded-2xl bg-purple-500/10 text-purple-400 mb-1" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "scale", className: "w-6 h-6" })), /* @__PURE__ */ React.createElement("h3", { className: "text-2xl font-bold text-white" }, "Negotiate Project Price"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400" }, "Order: ", /* @__PURE__ */ React.createElement("strong", { className: "text-white" }, currentOrder.id), " (", currentOrder.projectType, ")")), /* @__PURE__ */ React.createElement("div", { className: "p-3.5 rounded-2xl bg-white/5 border border-white/5 text-xs font-mono space-y-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-400" }, "Current Agreed Price:"), /* @__PURE__ */ React.createElement("span", { className: "text-white font-bold" }, "$", currentOrder.price, " USD (\u20B9", currentOrder.price * 86, ")")), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between text-[11px] text-gray-400" }, /* @__PURE__ */ React.createElement("span", null, "Standard Rate Range:"), /* @__PURE__ */ React.createElement("span", { className: "text-emerald-400" }, ((_b = RATE_CARD.find((r) => r.type === currentOrder.projectType)) == null ? void 0 : _b.clientPriceRangeUSD) || "$25 - $200"))), /* @__PURE__ */ React.createElement("form", { onSubmit: handleNegotiationSubmit, className: "space-y-4 text-xs font-sans" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-300 block mb-1" }, "Your Proposed Budget ($ USD) *"), /* @__PURE__ */ React.createElement("div", { className: "relative" }, /* @__PURE__ */ React.createElement("span", { className: "absolute left-4 top-3 text-gray-500 font-mono" }, "$"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      required: true,
      min: "10",
      placeholder: "e.g. 140",
      value: negotiationInput.proposedPrice,
      onChange: (e) => setNegotiationInput({ ...negotiationInput, proposedPrice: e.target.value }),
      className: "w-full bg-black/60 border border-white/15 rounded-xl pl-8 pr-4 py-3 text-white font-mono focus:outline-none focus:border-purple-500"
    }
  )), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 font-mono mt-1 block" }, "Equivalent to \u20B9", (Number(negotiationInput.proposedPrice) || 0) * 86, " INR")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-[11px] font-mono text-gray-300 block mb-1" }, "Reason / Scope Notes"), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      rows: "3",
      placeholder: "Explain package volume, simpler cut requirements, or long-term engagement...",
      value: negotiationInput.note,
      onChange: (e) => setNegotiationInput({ ...negotiationInput, note: e.target.value }),
      className: "w-full bg-white/5 border border-white/10 rounded-xl p-3.5 text-white focus:outline-none focus:border-purple-500 resize-none font-sans"
    }
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "submit",
      className: "w-full py-3.5 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-purple-500/25 flex items-center justify-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "send", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "Submit Counter-Offer to Admin")
  )))), rateCardModalOpen && /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel max-w-3xl w-full p-8 rounded-3xl border border-white/10 space-y-6 glow-emerald max-h-[90vh] overflow-y-auto relative" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setRateCardModalOpen(false), className: "absolute top-6 right-6 text-gray-400 hover:text-white" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "x", className: "w-5 h-5" })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider" }, "Lilizzh Studio Standard Pricing Guide"), /* @__PURE__ */ React.createElement("h3", { className: "text-2xl font-bold text-white mt-2" }, "Video Editing Rate Card"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400" }, showMargins ? "Complete breakdown of client ranges, editor allocations, and agency margins." : "Complete breakdown of client price ranges and typical turnaround times.")), /* @__PURE__ */ React.createElement("div", { className: "overflow-x-auto" }, /* @__PURE__ */ React.createElement("table", { className: "w-full text-left text-xs font-mono" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { className: "border-b border-white/15 text-gray-400" }, /* @__PURE__ */ React.createElement("th", { className: "py-3 px-2" }, "Project Type"), /* @__PURE__ */ React.createElement("th", { className: "py-3 px-2 text-emerald-400" }, "Client Price"), showMargins && /* @__PURE__ */ React.createElement("th", { className: "py-3 px-2 text-purple-300" }, "Editor Payout"), showMargins && /* @__PURE__ */ React.createElement("th", { className: "py-3 px-2 text-blue-400" }, "Studio Profit"), /* @__PURE__ */ React.createElement("th", { className: "py-3 px-2" }, "Action"))), /* @__PURE__ */ React.createElement("tbody", { className: "divide-y divide-white/10" }, RATE_CARD.map((row) => /* @__PURE__ */ React.createElement("tr", { key: row.id, className: "hover:bg-white/[0.02]" }, /* @__PURE__ */ React.createElement("td", { className: "py-4 px-2" }, /* @__PURE__ */ React.createElement("strong", { className: "text-white block font-sans text-sm" }, row.type), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 font-sans" }, row.description)), /* @__PURE__ */ React.createElement("td", { className: "py-4 px-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-emerald-400 font-bold block" }, row.clientPriceRangeUSD), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 font-sans" }, row.clientPriceRangeINR)), showMargins && /* @__PURE__ */ React.createElement("td", { className: "py-4 px-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-purple-300 font-bold block" }, row.editorPayoutRangeUSD), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 font-sans" }, row.editorPayoutRangeINR)), showMargins && /* @__PURE__ */ React.createElement("td", { className: "py-4 px-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-blue-400 font-bold block" }, row.profitRangeUSD), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 font-sans" }, row.profitRangeINR)), /* @__PURE__ */ React.createElement("td", { className: "py-4 px-2" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        setRateCardModalOpen(false);
        handleHireClick(null, row.type);
      },
      className: "px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] whitespace-nowrap"
    },
    "Select"
  ))))))), /* @__PURE__ */ React.createElement("div", { className: "p-4 rounded-2xl bg-white/5 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-2 text-gray-300" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "scale", className: "w-4 h-4 text-purple-400 shrink-0" }), /* @__PURE__ */ React.createElement("span", null, "Have custom volume or long-term project requirements? Negotiation is available on all contracts.")), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setRateCardModalOpen(false),
      className: "px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-mono text-xs self-start sm:self-auto"
    },
    "Close Guide"
  )))), portfolioModalEditor && /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel max-w-2xl w-full p-8 rounded-3xl border border-white/10 space-y-6 glow-blue max-h-[90vh] overflow-y-auto relative" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setPortfolioModalEditor(null),
      className: "absolute top-6 right-6 text-gray-400 hover:text-white"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "x", className: "w-5 h-5" })
  ), /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-4" }, /* @__PURE__ */ React.createElement("img", { src: portfolioModalEditor.avatar, alt: portfolioModalEditor.name, className: "w-16 h-16 rounded-2xl object-cover border-2 border-blue-500/40" }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "text-2xl font-bold text-white" }, portfolioModalEditor.name), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-blue-400 font-mono mt-0.5" }, portfolioModalEditor.role, " \u2022 Rating ", portfolioModalEditor.rating, " \u2605"))), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-300 leading-relaxed bg-white/5 p-4 rounded-2xl border border-white/5 font-sans" }, portfolioModalEditor.bio), /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, /* @__PURE__ */ React.createElement("h4", { className: "text-xs font-mono font-bold text-gray-400 uppercase tracking-wider" }, "Sample Video Portfolio"), portfolioModalEditor.portfolioVideos.map((vid, idx) => /* @__PURE__ */ React.createElement("div", { key: idx, className: "space-y-2" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-bold text-white block" }, vid.title), /* @__PURE__ */ React.createElement("div", { className: "aspect-video bg-black rounded-2xl overflow-hidden border border-white/10" }, /* @__PURE__ */ React.createElement("video", { controls: true, playsInline: true, className: "w-full h-full object-cover", src: vid.url }))))), /* @__PURE__ */ React.createElement("div", { className: "pt-4 border-t border-white/10 flex justify-end space-x-3" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => setPortfolioModalEditor(null),
      className: "px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-gray-300"
    },
    "Close"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => {
        const ed = portfolioModalEditor;
        setPortfolioModalEditor(null);
        handleHireClick(ed);
      },
      className: "px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-lg shadow-blue-500/25 flex items-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("span", null, "Hire ", portfolioModalEditor.name.split(" ")[0], " Now"),
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "arrow-right", className: "w-4 h-4" })
  )))), previewFile && /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel max-w-2xl w-full p-6 rounded-3xl border border-white/10 space-y-4 glow-blue" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between border-b border-white/10 pb-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-2 truncate" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "eye", className: "w-5 h-5 text-blue-400 shrink-0" }), /* @__PURE__ */ React.createElement("h3", { className: "text-sm font-bold text-white font-mono truncate" }, previewFile.name)), /* @__PURE__ */ React.createElement("button", { onClick: () => setPreviewFile(null), className: "text-gray-400 hover:text-white" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "x", className: "w-5 h-5" }))), /* @__PURE__ */ React.createElement("div", { className: "aspect-video bg-black rounded-2xl overflow-hidden flex items-center justify-center border border-white/5" }, previewFile.name.match(/\.(mp4|webm|mov)$/i) ? /* @__PURE__ */ React.createElement("video", { controls: true, playsInline: true, className: "w-full h-full object-contain", src: previewFile.url + "?inline=1" }) : previewFile.name.match(/\.(png|jpg|jpeg|webp)$/i) ? /* @__PURE__ */ React.createElement("img", { src: previewFile.url + "?inline=1", alt: previewFile.name, className: "max-h-full object-contain" }) : /* @__PURE__ */ React.createElement("div", { className: "text-center p-6 font-mono text-xs text-gray-400" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "file-text", className: "w-12 h-12 mx-auto mb-2 text-blue-400" }), /* @__PURE__ */ React.createElement("span", null, "Format: Binary / LUT / Archive"), /* @__PURE__ */ React.createElement("span", { className: "block mt-1 text-gray-500" }, previewFile.size))), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center text-xs font-mono text-gray-400 pt-2" }, /* @__PURE__ */ React.createElement("span", null, "Folder: ", previewFile.folder || "Raw Footage"), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => handleDownloadFile(previewFile),
      className: "px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center space-x-2 transition-all shadow-md"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "download", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "Download File")
  )))), paymentModalOpen && currentOrder && /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel max-w-lg w-full p-8 rounded-3xl border border-white/10 space-y-6 glow-emerald max-h-[90vh] overflow-y-auto relative" }, /* @__PURE__ */ React.createElement("button", { onClick: () => setPaymentModalOpen(false), className: "absolute top-6 right-6 text-gray-400 hover:text-white" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "x", className: "w-5 h-5" })), /* @__PURE__ */ React.createElement("div", { className: "text-center space-y-1.5" }, /* @__PURE__ */ React.createElement("span", { className: "px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider" }, "Secure UPI Payment"), /* @__PURE__ */ React.createElement("h3", { className: "text-2xl font-bold text-white" }, "Unlock 4K Master Render"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400" }, "Amount Due: ", /* @__PURE__ */ React.createElement("strong", { className: "text-white" }, "$", currentOrder.price, " USD / \u20B9", paymentInfo ? paymentInfo.amountINR : currentOrder.price * 86, " INR"))), paymentInfo ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col items-center justify-center bg-white/5 p-4 rounded-2xl border border-emerald-500/30 text-center space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "p-3 bg-white rounded-2xl shadow-xl" }, /* @__PURE__ */ React.createElement(
    "img",
    {
      src: paymentInfo.qrUrl,
      alt: "UPI Payment QR Code",
      className: "w-44 h-44 object-contain"
    }
  )), /* @__PURE__ */ React.createElement("span", { className: "text-[11px] text-gray-300 font-mono" }, "Scan with GPay, PhonePe, Paytm or BHIM (Amount: \u20B9", paymentInfo.amountINR, ")"), /* @__PURE__ */ React.createElement("a", { href: paymentInfo.upiUri, className: "px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold" }, "Open in UPI app (on phone)")), /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-5 rounded-2xl border border-emerald-500/30 space-y-2.5 bg-emerald-950/20 text-xs font-mono" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-400" }, "Pay to:"), /* @__PURE__ */ React.createElement("span", { className: "text-white font-bold" }, paymentInfo.accountName)), /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center pt-2 border-t border-white/10" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-400" }, "UPI ID:"), /* @__PURE__ */ React.createElement("span", { className: "text-blue-400 font-bold select-all" }, paymentInfo.upiId)))) : /* @__PURE__ */ React.createElement("div", { className: "text-center text-xs font-mono text-gray-400 py-8" }, paymentInfoError || "Loading secure payment details..."), /* @__PURE__ */ React.createElement("form", { onSubmit: handlePaymentProofSubmit, className: "space-y-4 pt-1 font-sans" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-xs font-mono text-gray-300 block mb-1" }, "Enter Transaction Reference / UTR Number *"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      required: true,
      placeholder: "e.g. UTR49281029384 or 329182049102",
      value: utrNumber,
      onChange: (e) => setUtrNumber(e.target.value),
      className: "w-full bg-black/60 border border-white/20 rounded-xl px-4 py-3 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
    }
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "submit",
      className: "w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-xl flex items-center justify-center space-x-2"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "check", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "Submit UTR & Register Payment")
  )))));
}
function EditorWorkspace({ orders, onOrder, showAlert, currentUser }) {
  var _a, _b;
  const editorAssignedOrders = orders.filter(
    (o) => o.editor.toLowerCase().includes(currentUser.name.toLowerCase().split(" ")[0])
  );
  const [selectedOrderId, setSelectedOrderId] = useState(((_a = editorAssignedOrders[0]) == null ? void 0 : _a.id) || ((_b = orders[0]) == null ? void 0 : _b.id) || "");
  const currentOrder = orders.find((o) => o.id === selectedOrderId) || orders[0];
  const [editorReply, setEditorReply] = useState("");
  const [newDraftUrl, setNewDraftUrl] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("Raw Footage");
  useEffect(() => {
    if (editorAssignedOrders.length > 0 && !editorAssignedOrders.some((o) => o.id === selectedOrderId)) {
      setSelectedOrderId(editorAssignedOrders[0].id);
    }
  }, [editorAssignedOrders]);
  const handleUploadDraft = async (e) => {
    e.preventDefault();
    if (!newDraftUrl.trim() || !currentOrder) return;
    try {
      const { order } = await api("PUT", `/orders/${currentOrder.id}/draft`, { url: newDraftUrl.trim() });
      onOrder(order);
      setNewDraftUrl("");
      showAlert("Draft Published!", "New watermarked preview draft published to client.", "success");
    } catch (err) {
      showAlert("Draft Not Published", err.message, "error");
    }
  };
  const handleSendEditorChat = async (e) => {
    e.preventDefault();
    if (!editorReply.trim() || !currentOrder) return;
    const text = editorReply.trim();
    setEditorReply("");
    try {
      const { order } = await api("POST", `/orders/${currentOrder.id}/messages`, { text });
      onOrder(order);
    } catch (err) {
      setEditorReply(text);
      showAlert("Message Not Sent", err.message, "error");
    }
  };
  const currentFolders = (currentOrder == null ? void 0 : currentOrder.folders) || ["Raw Footage", "Audio & Music", "Graphics & B-Roll"];
  const currentFiles = ((currentOrder == null ? void 0 : currentOrder.uploadedFiles) || []).filter((f) => (f.folder || "Raw Footage") === selectedFolder);
  return /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fadeIn" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-purple-500/30 flex flex-col md:flex-row md:items-center justify-between gap-4 glow-purple" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-4" }, /* @__PURE__ */ React.createElement("div", { className: "w-14 h-14 rounded-2xl bg-gradient-to-tr from-purple-600 to-blue-500 p-0.5 flex items-center justify-center" }, /* @__PURE__ */ React.createElement("div", { className: "w-full h-full bg-obsidian rounded-[14px] flex items-center justify-center text-purple-400 font-bold text-xl" }, currentUser.name.charAt(0))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-mono font-bold uppercase tracking-wider" }, "Dedicated Editor Workspace"), /* @__PURE__ */ React.createElement("h2", { className: "text-2xl font-bold text-white mt-1" }, "Welcome, ", currentUser.name), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400" }, "Review assigned projects, inspect vaulted raw footage, and deliver export drafts."))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3 bg-black/50 px-4 py-2.5 rounded-2xl border border-white/10 font-mono text-xs" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-400" }, "Assigned Queue:"), /* @__PURE__ */ React.createElement("span", { className: "text-purple-400 font-bold text-sm" }, editorAssignedOrders.length, " Projects"))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 lg:grid-cols-4 gap-8" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-4 lg:col-span-1" }, /* @__PURE__ */ React.createElement("h3", { className: "text-xs font-mono text-gray-400 uppercase tracking-widest" }, "Assigned Queue"), editorAssignedOrders.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "text-center py-8 text-gray-500 text-xs italic" }, "No briefs currently assigned to you. Admin will route incoming projects.") : /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, editorAssignedOrders.map((o) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: o.id,
      onClick: () => setSelectedOrderId(o.id),
      className: `w-full text-left p-4 rounded-2xl transition-all border ${selectedOrderId === o.id ? "bg-purple-600/25 border-purple-500/60 text-white shadow-lg" : "bg-white/5 border-white/5 text-gray-400 hover:text-white"}`
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center mb-1" }, /* @__PURE__ */ React.createElement("span", { className: "font-mono text-xs font-bold text-purple-400" }, o.id), /* @__PURE__ */ React.createElement("span", { className: `w-2 h-2 rounded-full ${o.unlocked ? "bg-emerald-400" : "bg-amber-400"}` })),
    /* @__PURE__ */ React.createElement("p", { className: "text-xs font-bold text-white truncate" }, o.projectType),
    /* @__PURE__ */ React.createElement("p", { className: "text-[10px] text-gray-400 mt-0.5 truncate" }, "Client: ", o.clientName)
  )))), currentOrder ? /* @__PURE__ */ React.createElement("div", { className: "lg:col-span-3 space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "px-3 py-1 rounded-full bg-blue-500/20 text-blue-400 text-xs font-mono font-bold" }, "Client: ", currentOrder.clientName, " (", currentOrder.clientEmail, ")"), /* @__PURE__ */ React.createElement("h3", { className: "text-2xl font-bold text-white mt-2" }, currentOrder.projectType), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-0.5" }, "Phone: ", /* @__PURE__ */ React.createElement("strong", { className: "text-white" }, currentOrder.phone), " \u2022 Status: ", /* @__PURE__ */ React.createElement("strong", { className: "text-emerald-400" }, currentOrder.status))), /* @__PURE__ */ React.createElement("div", { className: "text-right" }, /* @__PURE__ */ React.createElement("span", { className: "text-xs font-mono text-gray-400 block" }, "Agreed Budget:"), /* @__PURE__ */ React.createElement("span", { className: "text-xl font-bold text-white" }, "$", currentOrder.price, " USD"))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-4" }, /* @__PURE__ */ React.createElement("h4", { className: "text-sm font-bold text-white flex items-center space-x-2" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "play-circle", className: "w-4 h-4 text-purple-400" }), /* @__PURE__ */ React.createElement("span", null, "Current Preview Draft")), /* @__PURE__ */ React.createElement("div", { className: "aspect-video bg-black rounded-2xl overflow-hidden relative" }, /* @__PURE__ */ React.createElement("video", { controls: true, className: "w-full h-full object-cover", src: currentOrder.draftUrl })), /* @__PURE__ */ React.createElement("form", { onSubmit: handleUploadDraft, className: "space-y-2 pt-2" }, /* @__PURE__ */ React.createElement("label", { className: "text-xs font-mono text-gray-400 block" }, "Publish New Preview Video URL (.mp4)"), /* @__PURE__ */ React.createElement("div", { className: "flex space-x-2" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "url",
      required: true,
      placeholder: "https://... (direct video mp4 link)",
      value: newDraftUrl,
      onChange: (e) => setNewDraftUrl(e.target.value),
      className: "flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
    }
  ), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all" }, "Publish")))), /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement("h4", { className: "text-sm font-bold text-white flex items-center space-x-2" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "folder", className: "w-4 h-4 text-blue-400" }), /* @__PURE__ */ React.createElement("span", null, "Client Vaulted Assets")), /* @__PURE__ */ React.createElement("div", { className: "flex space-x-1 overflow-x-auto text-[10px] font-mono" }, currentFolders.map((folder) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: folder,
      onClick: () => setSelectedFolder(folder),
      className: `px-2.5 py-1 rounded-lg ${selectedFolder === folder ? "bg-blue-600 text-white font-bold" : "bg-white/5 text-gray-400"}`
    },
    folder
  )))), /* @__PURE__ */ React.createElement("div", { className: "space-y-2 max-h-56 overflow-y-auto pr-1" }, currentFiles.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-500 italic py-8 text-center" }, "No files uploaded in [", selectedFolder, "].") : currentFiles.map((file) => /* @__PURE__ */ React.createElement("div", { key: file.id, className: "p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs font-mono" }, /* @__PURE__ */ React.createElement("div", { className: "truncate pr-2" }, /* @__PURE__ */ React.createElement("p", { className: "text-white font-bold truncate font-sans" }, file.name), /* @__PURE__ */ React.createElement("p", { className: "text-[10px] text-gray-400" }, file.size, " \u2022 ", file.date)), /* @__PURE__ */ React.createElement(
    "a",
    {
      href: file.url,
      target: "_blank",
      rel: "noreferrer",
      className: "px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white text-xs font-mono transition-colors"
    },
    "Download"
  )))))), /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-4" }, /* @__PURE__ */ React.createElement("h4", { className: "text-sm font-bold text-white flex items-center space-x-2" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "message-square", className: "w-4 h-4 text-purple-400" }), /* @__PURE__ */ React.createElement("span", null, "Direct Chat with Client")), /* @__PURE__ */ React.createElement("div", { className: "max-h-48 overflow-y-auto space-y-2 p-4 rounded-2xl bg-black/40 border border-white/5 text-xs" }, (currentOrder.chatMessages || []).map((msg, idx) => /* @__PURE__ */ React.createElement("div", { key: idx, className: "text-xs" }, /* @__PURE__ */ React.createElement("span", { className: "font-mono text-gray-500 mr-2" }, "[", msg.time, "]"), /* @__PURE__ */ React.createElement("span", { className: msg.sender === "editor" ? "text-purple-400 font-bold" : msg.sender === "client" ? "text-blue-400" : "text-gray-300" }, msg.text)))), /* @__PURE__ */ React.createElement("form", { onSubmit: handleSendEditorChat, className: "flex space-x-2" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "Send production update or notes to client...",
      value: editorReply,
      onChange: (e) => setEditorReply(e.target.value),
      className: "flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500"
    }
  ), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all" }, "Send")))) : /* @__PURE__ */ React.createElement("div", { className: "lg:col-span-3 glass-panel p-12 rounded-3xl text-center space-y-4" }, /* @__PURE__ */ React.createElement("h3", { className: "text-xl font-bold text-white" }, "No Projects Selected"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400" }, "Select an assigned project from the sidebar to begin editing."))));
}
function AdminDashboard({ orders, onOrder, showAlert, currentUser, onRosterChange, onConfigChange }) {
  var _a, _b;
  const [tab, setTab] = useState("orders");
  const [selectedOrderId, setSelectedOrderId] = useState(((_a = orders[0]) == null ? void 0 : _a.id) || "");
  const [adminReply, setAdminReply] = useState("");
  const [newCleanUrl, setNewCleanUrl] = useState("");
  const [newDraftUrl, setNewDraftUrl] = useState("");
  const [reassignEditorName, setReassignEditorName] = useState(EDITORS_LIST[0] ? EDITORS_LIST[0].id : "");
  const [customPriceUSD, setCustomPriceUSD] = useState("");
  const [customEditorPayoutUSD, setCustomEditorPayoutUSD] = useState("");
  const currentOrder = orders.find((o) => o.id === selectedOrderId) || orders[0];
  useEffect(() => {
    if (orders.length > 0 && !orders.some((o) => o.id === selectedOrderId)) {
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
  const pendingVerifications = orders.filter((o) => o.paymentProof && !o.unlocked).length;
  const pendingNegotiations = orders.filter((o) => o.negotiation && o.negotiation.status === "PENDING_ADMIN_REVIEW").length;
  const failWith = (title) => (err) => showAlert(title, err.message, "error");
  const handleUnlockMaster = async (unlockedState) => {
    if (!currentOrder) return;
    try {
      const { order } = await api("POST", `/admin/orders/${currentOrder.id}/unlock`, { unlocked: unlockedState });
      onOrder(order);
      showAlert("Project Master Updated", unlockedState ? "4K Master render unlocked for client." : "Project marked as locked draft.", "success");
    } catch (err) {
      failWith("Could Not Update Master")(err);
    }
  };
  const handleSaveCustomPricing = async (e) => {
    e.preventDefault();
    if (!currentOrder) return;
    const newPrice = Number(customPriceUSD);
    const newPayout = Number(customEditorPayoutUSD);
    if (newPrice <= 0) {
      showAlert("Invalid Pricing", "Please enter a valid price amount.", "error");
      return;
    }
    const profitUSD = newPrice - newPayout;
    try {
      const { order } = await api("POST", `/admin/orders/${currentOrder.id}/pricing`, { price: newPrice, editorPayout: newPayout });
      onOrder(order);
      showAlert("Pricing Updated!", `Order ${currentOrder.id} price set to $${newPrice} USD. Profit margin: $${profitUSD} USD.`, "success");
    } catch (err) {
      failWith("Pricing Not Saved")(err);
    }
  };
  const handleAcceptNegotiation = async () => {
    if (!currentOrder || !currentOrder.negotiation) return;
    try {
      const { order } = await api("POST", `/admin/orders/${currentOrder.id}/negotiation`, { decision: "accept" });
      onOrder(order);
      setCustomPriceUSD(order.price);
      setCustomEditorPayoutUSD(order.editorPayout);
      showAlert("Offer Accepted!", `Client price updated to $${order.price} USD.`, "success");
    } catch (err) {
      failWith("Could Not Accept Offer")(err);
    }
  };
  const handleRejectNegotiation = async () => {
    if (!currentOrder || !currentOrder.negotiation) return;
    try {
      const { order } = await api("POST", `/admin/orders/${currentOrder.id}/negotiation`, { decision: "decline" });
      onOrder(order);
      showAlert("Offer Declined", "Negotiation declined. Original price preserved.", "info");
    } catch (err) {
      failWith("Could Not Decline Offer")(err);
    }
  };
  const handleReassignEditor = async (e) => {
    e.preventDefault();
    if (!currentOrder) return;
    try {
      const { order } = await api("POST", `/admin/orders/${currentOrder.id}/reassign`, { editorId: reassignEditorName });
      onOrder(order);
      showAlert("Editor Reassigned", `Project successfully routed to ${order.editor} workspace.`, "success");
    } catch (err) {
      failWith("Could Not Reassign")(err);
    }
  };
  const [adminPrivate, setAdminPrivate] = useState(false);
  const handleSendAdminMessage = async (e) => {
    e.preventDefault();
    if (!adminReply.trim() || !currentOrder) return;
    const text = adminReply.trim();
    setAdminReply("");
    try {
      const { order } = await api("POST", `/orders/${currentOrder.id}/messages`, { text, private: adminPrivate });
      onOrder(order);
    } catch (err) {
      setAdminReply(text);
      failWith("Message Not Sent")(err);
    }
  };
  const handleUpdateLinks = async (e) => {
    e.preventDefault();
    if (!currentOrder) return;
    try {
      const { order } = await api("PUT", `/admin/orders/${currentOrder.id}/links`, {
        draftUrl: newDraftUrl.trim() || null,
        cleanUrl: newCleanUrl.trim() || null
      });
      onOrder(order);
      setNewCleanUrl("");
      setNewDraftUrl("");
      showAlert("Render Links Updated", "Video export URLs updated across client and editor dashboards.", "success");
    } catch (err) {
      failWith("Links Not Updated")(err);
    }
  };
  return /* @__PURE__ */ React.createElement("div", { className: "max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8 animate-fadeIn" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-emerald-500/30 flex flex-col md:flex-row md:items-center justify-between gap-6 glow-emerald" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3" }, /* @__PURE__ */ React.createElement("span", { className: "px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider" }, "Studio Executive Dashboard"), /* @__PURE__ */ React.createElement("span", { className: "text-xs font-mono text-gray-400" }, "Staff: ", currentUser.name)), /* @__PURE__ */ React.createElement("h2", { className: "text-2xl md:text-3xl font-extrabold text-white mt-1" }, "Lilizzh Operations & Pricing Authority"), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-0.5" }, "Control pricing, review client negotiations, track profit margins, verify UPI payments, and unlock 4K masters.")), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-3 text-xs font-mono" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel px-4 py-2.5 rounded-2xl border border-white/10 text-center" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-400 block text-[10px]" }, "VERIFIED REVENUE"), /* @__PURE__ */ React.createElement("span", { className: "text-lg font-bold text-emerald-400" }, "$", totalRevenueUSD, " USD"), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 block font-sans" }, "\u20B9", totalRevenueINR, " INR")), /* @__PURE__ */ React.createElement("div", { className: "glass-panel px-4 py-2.5 rounded-2xl border border-white/10 text-center" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-400 block text-[10px]" }, "PENDING UTRs"), /* @__PURE__ */ React.createElement("span", { className: "text-lg font-bold text-amber-400" }, pendingVerifications, " Requests")), /* @__PURE__ */ React.createElement("div", { className: "glass-panel px-4 py-2.5 rounded-2xl border border-purple-500/30 text-center" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-400 block text-[10px]" }, "NEGOTIATIONS"), /* @__PURE__ */ React.createElement("span", { className: "text-lg font-bold text-purple-400" }, pendingNegotiations, " Offers")))), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2 text-xs font-mono" }, [["orders", "Orders"], ["editors", "Editors"], ["pricing", "Pricing"], ["inquiries", "Inquiries"]].map(([id, label]) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: id,
      type: "button",
      onClick: () => setTab(id),
      className: `px-4 py-2 rounded-xl border transition-all ${tab === id ? "bg-emerald-600 text-white border-emerald-500 font-bold" : "bg-white/5 border-white/10 text-gray-400 hover:text-white"}`
    },
    label
  ))), tab === "editors" && /* @__PURE__ */ React.createElement(AdminEditors, { showAlert, onRosterChange }), tab === "pricing" && /* @__PURE__ */ React.createElement(AdminPricing, { showAlert, onConfigChange }), tab === "inquiries" && /* @__PURE__ */ React.createElement(AdminInquiries, { showAlert }), tab === "orders" && /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 lg:grid-cols-4 gap-8" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-4 lg:col-span-1" }, /* @__PURE__ */ React.createElement("h3", { className: "text-xs font-mono text-gray-400 uppercase tracking-widest" }, "Incoming Client Orders (", orders.length, ")"), /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, orders.map((o) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: o.id,
      onClick: () => setSelectedOrderId(o.id),
      className: `w-full text-left p-4 rounded-2xl transition-all border ${selectedOrderId === o.id ? "bg-blue-600/20 border-blue-500/50 text-white shadow-lg" : "bg-white/5 border-white/5 text-gray-400 hover:text-white"}`
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center mb-1" }, /* @__PURE__ */ React.createElement("span", { className: "font-mono text-xs font-bold text-blue-400" }, o.id), /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-1" }, o.negotiation && o.negotiation.status === "PENDING_ADMIN_REVIEW" && /* @__PURE__ */ React.createElement("span", { className: "px-1.5 py-0.5 rounded text-[9px] bg-purple-500/30 text-purple-300 font-mono font-bold" }, "NEG"), /* @__PURE__ */ React.createElement("span", { className: `w-2 h-2 rounded-full ${o.unlocked ? "bg-emerald-400" : o.paymentProof ? "bg-amber-400 animate-pulse" : "bg-gray-600"}` }))),
    /* @__PURE__ */ React.createElement("p", { className: "text-xs font-bold text-white truncate" }, o.projectType),
    /* @__PURE__ */ React.createElement("div", { className: "flex justify-between items-center text-[10px] text-gray-400 mt-1" }, /* @__PURE__ */ React.createElement("span", null, o.clientName), /* @__PURE__ */ React.createElement("span", { className: "text-emerald-400 font-mono font-bold" }, "$", o.price))
  )))), currentOrder && /* @__PURE__ */ React.createElement("div", { className: "lg:col-span-3 space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-6" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3" }, /* @__PURE__ */ React.createElement("h3", { className: "text-xl font-bold text-white" }, currentOrder.projectType), /* @__PURE__ */ React.createElement("span", { className: `px-3 py-1 rounded-full text-xs font-mono font-bold ${currentOrder.unlocked ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}` }, currentOrder.unlocked ? "UNLOCKED" : "LOCKED / WATERMARKED DRAFT")), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-400 mt-1" }, "Client: ", /* @__PURE__ */ React.createElement("strong", { className: "text-white" }, currentOrder.clientName), " (", currentOrder.clientEmail, ") \u2022 Phone: ", /* @__PURE__ */ React.createElement("strong", { className: "text-emerald-400" }, currentOrder.phone), " \u2022 Editor: ", /* @__PURE__ */ React.createElement("strong", { className: "text-purple-400" }, currentOrder.editor))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-3" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => handleUnlockMaster(!currentOrder.unlocked),
      className: `px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-lg ${currentOrder.unlocked ? "bg-amber-600 hover:bg-amber-500 text-white" : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/25"}`
    },
    currentOrder.unlocked ? "Lock to Draft Mode" : "Verify & Unlock Clean 4K Master"
  ))), currentOrder.negotiation && /* @__PURE__ */ React.createElement("div", { className: "p-5 rounded-2xl bg-purple-950/30 border border-purple-500/40 space-y-3 glow-purple" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-2 text-purple-300 font-bold font-mono text-xs" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "scale", className: "w-4 h-4" }), /* @__PURE__ */ React.createElement("span", null, "Client Price Negotiation Request"), /* @__PURE__ */ React.createElement("span", { className: "px-2 py-0.5 rounded-full text-[10px] bg-purple-500/20 border border-purple-500/30 text-purple-200" }, currentOrder.negotiation.status)), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 font-mono" }, "Current Price: $", currentOrder.price, " \u2192 Requested: ", /* @__PURE__ */ React.createElement("strong", { className: "text-emerald-400 text-xs" }, "$", currentOrder.negotiation.proposedPrice))), /* @__PURE__ */ React.createElement("p", { className: "text-xs text-gray-300 font-sans italic bg-black/40 p-3 rounded-xl border border-white/5" }, '"', currentOrder.negotiation.clientNote || "No specific note provided", '"'), currentOrder.negotiation.status === "PENDING_ADMIN_REVIEW" && /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center gap-3 pt-1" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: handleAcceptNegotiation,
      className: "px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all flex items-center space-x-1.5"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "check", className: "w-3.5 h-3.5" }),
    /* @__PURE__ */ React.createElement("span", null, "Accept Offer ($", currentOrder.negotiation.proposedPrice, ")")
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: handleRejectNegotiation,
      className: "px-4 py-2 rounded-xl bg-red-600/30 hover:bg-red-600 text-red-300 hover:text-white font-bold text-xs border border-red-500/40 transition-all flex items-center space-x-1.5"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "x", className: "w-3.5 h-3.5" }),
    /* @__PURE__ */ React.createElement("span", null, "Decline Offer")
  ))), /* @__PURE__ */ React.createElement("form", { onSubmit: handleSaveCustomPricing, className: "p-5 rounded-2xl bg-black/50 border border-emerald-500/30 space-y-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-2" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "calculator", className: "w-4 h-4 text-emerald-400" }), /* @__PURE__ */ React.createElement("h4", { className: "text-xs font-mono font-bold text-white uppercase tracking-wider" }, "Admin Pricing Authority & Margin Control")), /* @__PURE__ */ React.createElement("span", { className: "text-[11px] font-mono text-gray-400" }, "Rate Card Benchmark: ", /* @__PURE__ */ React.createElement("strong", { className: "text-emerald-400" }, ((_b = RATE_CARD.find((r) => r.type === currentOrder.projectType)) == null ? void 0 : _b.clientPriceRangeUSD) || "$25 - $200"))), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-gray-400 block mb-1" }, "Client Agreed Price ($ USD)"), /* @__PURE__ */ React.createElement("div", { className: "relative" }, /* @__PURE__ */ React.createElement("span", { className: "absolute left-3 top-2.5 text-gray-500" }, "$"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      required: true,
      min: "1",
      value: customPriceUSD,
      onChange: (e) => setCustomPriceUSD(e.target.value),
      className: "w-full bg-white/5 border border-white/15 rounded-xl pl-7 pr-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
    }
  )), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-500 mt-1 block" }, "= \u20B9", (Number(customPriceUSD) || 0) * 86, " INR")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-gray-400 block mb-1" }, "Editor Payout ($ USD)"), /* @__PURE__ */ React.createElement("div", { className: "relative" }, /* @__PURE__ */ React.createElement("span", { className: "absolute left-3 top-2.5 text-gray-500" }, "$"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      required: true,
      min: "0",
      value: customEditorPayoutUSD,
      onChange: (e) => setCustomEditorPayoutUSD(e.target.value),
      className: "w-full bg-white/5 border border-white/15 rounded-xl pl-7 pr-3 py-2 text-white font-mono focus:outline-none focus:border-purple-500"
    }
  )), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-500 mt-1 block" }, "= \u20B9", (Number(customEditorPayoutUSD) || 0) * 86, " INR")), /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-3 rounded-xl border border-white/10 flex flex-col justify-center" }, /* @__PURE__ */ React.createElement("span", { className: "text-gray-400 text-[10px]" }, "STUDIO GROSS PROFIT"), /* @__PURE__ */ React.createElement("span", { className: "text-lg font-bold text-emerald-400 font-mono" }, "$", (Number(customPriceUSD) || 0) - (Number(customEditorPayoutUSD) || 0), " USD"), /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-400 font-mono" }, "\u20B9", ((Number(customPriceUSD) || 0) - (Number(customEditorPayoutUSD) || 0)) * 86, " INR"))), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "submit",
      className: "px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all shadow-md flex items-center space-x-1.5"
    },
    /* @__PURE__ */ React.createElement("i", { "data-lucide": "check-check", className: "w-4 h-4" }),
    /* @__PURE__ */ React.createElement("span", null, "Apply & Update Project Pricing")
  )), currentOrder.paymentProof ? /* @__PURE__ */ React.createElement("div", { className: "p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "flex items-center space-x-2 text-emerald-400 text-xs font-mono font-bold" }, /* @__PURE__ */ React.createElement("i", { "data-lucide": "check-circle", className: "w-4 h-4" }), /* @__PURE__ */ React.createElement("span", null, "Client Submitted Payment Proof (UTR)")), /* @__PURE__ */ React.createElement("p", { className: "text-xs font-mono text-white mt-1" }, "Reference: ", /* @__PURE__ */ React.createElement("strong", null, currentOrder.paymentProof.utr)), /* @__PURE__ */ React.createElement("p", { className: "text-[10px] text-gray-400 font-mono" }, "Method: ", currentOrder.paymentProof.method, " \u2022 Time: ", currentOrder.paymentProof.timestamp || "Recent")), !currentOrder.unlocked && /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: () => handleUnlockMaster(true),
      className: "px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg transition-all"
    },
    "Approve UTR & Unlock"
  )) : /* @__PURE__ */ React.createElement("div", { className: "p-4 rounded-2xl bg-white/5 border border-white/5 text-xs font-mono text-gray-400" }, "No UTR payment reference submitted yet by this client."), /* @__PURE__ */ React.createElement("form", { onSubmit: handleReassignEditor, className: "p-4 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h4", { className: "text-xs font-mono text-purple-300 font-bold" }, "Assign Project to Dedicated Editor"), /* @__PURE__ */ React.createElement("p", { className: "text-[10px] text-gray-400" }, "Route project briefs among Marcus Vance, Elena Rostova, Devon Sterling, or Aria Chen.")), /* @__PURE__ */ React.createElement("div", { className: "flex space-x-2" }, /* @__PURE__ */ React.createElement(
    "select",
    {
      value: reassignEditorName,
      onChange: (e) => setReassignEditorName(e.target.value),
      className: "bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
    },
    EDITORS_LIST.map((ed) => /* @__PURE__ */ React.createElement("option", { key: ed.id, value: ed.id }, ed.name, " (", ed.tag, ")"))
  ), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all" }, "Reassign"))), /* @__PURE__ */ React.createElement("form", { onSubmit: handleUpdateLinks, className: "space-y-4 pt-2 border-t border-white/10 font-sans text-xs" }, /* @__PURE__ */ React.createElement("h4", { className: "text-xs font-mono text-gray-400 uppercase font-bold" }, "Manage Video Export Links"), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-xs font-mono text-gray-400 block mb-1" }, "Watermarked Draft Video URL (.mp4)"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "url",
      placeholder: currentOrder.draftUrl,
      value: newDraftUrl,
      onChange: (e) => setNewDraftUrl(e.target.value),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono focus:outline-none focus:border-blue-500"
    }
  )), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("label", { className: "text-xs font-mono text-gray-400 block mb-1" }, "Clean 4K Master Video URL (.mp4)"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "url",
      placeholder: currentOrder.cleanUrl,
      value: newCleanUrl,
      onChange: (e) => setNewCleanUrl(e.target.value),
      className: "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono focus:outline-none focus:border-blue-500"
    }
  ))), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "submit",
      className: "px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-all shadow-md"
    },
    "Update Export URLs"
  )), /* @__PURE__ */ React.createElement("div", { className: "space-y-3 pt-2 border-t border-white/10" }, /* @__PURE__ */ React.createElement("h4", { className: "text-xs font-mono text-gray-400 uppercase font-bold" }, "Direct Studio Staff Chat & Broadcast"), /* @__PURE__ */ React.createElement("div", { className: "max-h-44 overflow-y-auto space-y-2 p-3 rounded-2xl bg-black/40 border border-white/5 text-xs" }, (currentOrder.chatMessages || []).map((msg, idx) => /* @__PURE__ */ React.createElement("div", { key: idx, className: "text-xs" }, /* @__PURE__ */ React.createElement("span", { className: "font-mono text-gray-500 mr-2" }, "[", msg.time, "]"), msg.private && /* @__PURE__ */ React.createElement("span", { className: "mr-1 px-1.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-mono" }, "PRIVATE"), /* @__PURE__ */ React.createElement("span", { className: msg.sender === "system" ? "text-emerald-400 font-bold" : msg.sender === "client" ? "text-blue-400" : "text-purple-400" }, msg.text)))), /* @__PURE__ */ React.createElement("label", { className: "flex items-center space-x-2 text-[11px] font-mono text-gray-400 cursor-pointer select-none" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: adminPrivate, onChange: (e) => setAdminPrivate(e.target.checked) }), /* @__PURE__ */ React.createElement("span", null, "Private to this client only (editor will not see it)")), /* @__PURE__ */ React.createElement("form", { onSubmit: handleSendAdminMessage, className: "flex space-x-2" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "Reply as Studio Staff...",
      value: adminReply,
      onChange: (e) => setAdminReply(e.target.value),
      className: "flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 font-sans"
    }
  ), /* @__PURE__ */ React.createElement("button", { type: "submit", className: "px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all" }, "Broadcast Note")))))));
}
const EMPTY_EDITOR = { name: "", roleTitle: "", tag: "YouTube", email: "", bio: "", badge: "" };
function AdminEditors({ showAlert, onRosterChange }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(EMPTY_EDITOR);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [secret, setSecret] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      setList((await api("GET", "/admin/editors")).editors);
    } catch (err) {
      showAlert("Could Not Load Editors", err.message, "error");
    }
  };
  useEffect(() => {
    load();
  }, []);
  const done = async () => {
    await load();
    if (onRosterChange) onRosterChange();
  };
  const run = async (fn, errTitle) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      showAlert(errTitle, err.message, "error");
    }
    setBusy(false);
  };
  const addEditor = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { name: form.name, roleTitle: form.roleTitle, tag: form.tag, email: form.email };
      if (form.bio.trim()) body.bio = form.bio;
      if (form.badge.trim()) body.badge = form.badge;
      const r = await api("POST", "/admin/editors", body);
      setSecret({ name: r.editor.name, id: r.editor.id, passcode: r.passcode });
      setForm(EMPTY_EDITOR);
      await done();
    }, "Editor Not Added");
  };
  const saveEdit = (id) => run(async () => {
    await api("PUT", `/admin/editors/${id}`, draft);
    setEditing(null);
    await done();
    showAlert("Editor Updated", "Changes are live on the website.", "success");
  }, "Editor Not Updated");
  const remove = (ed) => {
    if (!window.confirm(`Remove ${ed.name}? They will be hidden from clients and signed out.` + (ed.openOrders ? ` They still have ${ed.openOrders} open order(s) - reassign them from the Orders tab.` : ""))) return;
    run(async () => {
      await api("POST", `/admin/editors/${ed.id}/remove`);
      await done();
    }, "Editor Not Removed");
  };
  const restore = (ed) => run(async () => {
    await api("POST", `/admin/editors/${ed.id}/restore`);
    await done();
  }, "Editor Not Restored");
  const resetCode = (ed) => {
    if (!window.confirm(`Create a new passcode for ${ed.name}? Their old one stops working immediately.`)) return;
    run(async () => {
      const r = await api("POST", `/admin/editors/${ed.id}/passcode`);
      setSecret({ name: ed.name, id: ed.id, passcode: r.passcode });
    }, "Passcode Not Reset");
  };
  const input = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500";
  return /* @__PURE__ */ React.createElement("div", { className: "space-y-6" }, secret && /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-5 rounded-3xl border border-amber-500/40 bg-amber-950/20 space-y-2", "data-testid": "passcode-box" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs font-mono text-amber-300 font-bold uppercase" }, "One-time passcode - copy it now, it is never shown again"), /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-300" }, secret.name, " signs in as ", /* @__PURE__ */ React.createElement("strong", { className: "text-white" }, secret.id), " with passcode:"), /* @__PURE__ */ React.createElement("div", { className: "text-lg font-mono font-bold text-emerald-300 select-all", "data-testid": "passcode-value" }, secret.passcode), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => setSecret(null), className: "text-[11px] font-mono text-gray-400 hover:text-white underline" }, "I have saved it")), /* @__PURE__ */ React.createElement("form", { onSubmit: addEditor, className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-3" }, /* @__PURE__ */ React.createElement("h3", { className: "text-xs font-mono text-gray-400 uppercase tracking-widest" }, "Add a new editor"), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-4 gap-3" }, /* @__PURE__ */ React.createElement("input", { required: true, className: input, placeholder: "Name", value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }) }), /* @__PURE__ */ React.createElement("input", { required: true, className: input, placeholder: "Role (e.g. Colorist)", value: form.roleTitle, onChange: (e) => setForm({ ...form, roleTitle: e.target.value }) }), /* @__PURE__ */ React.createElement("select", { className: input, value: form.tag, onChange: (e) => setForm({ ...form, tag: e.target.value }) }, ["YouTube", "Shorts", "Documentary", "Ads"].map((t) => /* @__PURE__ */ React.createElement("option", { key: t, value: t, className: "bg-black" }, t))), /* @__PURE__ */ React.createElement("input", { required: true, type: "email", className: input, placeholder: "Editor email", value: form.email, onChange: (e) => setForm({ ...form, email: e.target.value }) }), /* @__PURE__ */ React.createElement("input", { className: `${input} md:col-span-3`, placeholder: "Short bio (optional)", value: form.bio, onChange: (e) => setForm({ ...form, bio: e.target.value }) }), /* @__PURE__ */ React.createElement("input", { className: input, placeholder: "Badge (optional)", value: form.badge, onChange: (e) => setForm({ ...form, badge: e.target.value }) })), /* @__PURE__ */ React.createElement("button", { disabled: busy, type: "submit", className: "px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50" }, "Add editor & create passcode")), /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-3" }, /* @__PURE__ */ React.createElement("h3", { className: "text-xs font-mono text-gray-400 uppercase tracking-widest" }, "Team (", list.filter((x) => x.active).length, " active)"), list.map((ed) => {
    var _a, _b, _c, _d, _e;
    return /* @__PURE__ */ React.createElement("div", { key: ed.id, className: `p-4 rounded-2xl border ${ed.active ? "bg-white/5 border-white/10" : "bg-black/40 border-white/5 opacity-70"}`, "data-testid": `editor-${ed.id}` }, editing === ed.id ? /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 md:grid-cols-4 gap-3" }, /* @__PURE__ */ React.createElement("input", { className: input, value: (_a = draft.name) != null ? _a : "", onChange: (e) => setDraft({ ...draft, name: e.target.value }), placeholder: "Name" }), /* @__PURE__ */ React.createElement("input", { className: input, value: (_b = draft.roleTitle) != null ? _b : "", onChange: (e) => setDraft({ ...draft, roleTitle: e.target.value }), placeholder: "Role" }), /* @__PURE__ */ React.createElement("input", { className: input, value: (_c = draft.tag) != null ? _c : "", onChange: (e) => setDraft({ ...draft, tag: e.target.value }), placeholder: "Tag" }), /* @__PURE__ */ React.createElement("input", { className: input, value: (_d = draft.email) != null ? _d : "", onChange: (e) => setDraft({ ...draft, email: e.target.value }), placeholder: "Email" }), /* @__PURE__ */ React.createElement("input", { className: `${input} md:col-span-4`, value: (_e = draft.bio) != null ? _e : "", onChange: (e) => setDraft({ ...draft, bio: e.target.value }), placeholder: "Bio" }), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement("button", { disabled: busy, onClick: () => saveEdit(ed.id), className: "px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold" }, "Save"), /* @__PURE__ */ React.createElement("button", { onClick: () => setEditing(null), className: "px-4 py-2 rounded-xl bg-white/5 text-gray-300 text-xs" }, "Cancel"))) : /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-center justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", { className: "text-xs" }, /* @__PURE__ */ React.createElement("div", { className: "text-white font-bold text-sm" }, ed.name, " ", /* @__PURE__ */ React.createElement("span", { className: "font-mono text-gray-500 text-[10px]" }, ed.id), !ed.active && /* @__PURE__ */ React.createElement("span", { className: "ml-2 px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-mono" }, "REMOVED")), /* @__PURE__ */ React.createElement("div", { className: "text-gray-400 font-mono" }, ed.roleTitle, " \xB7 ", ed.tag, " \xB7 ", ed.email, " \xB7 ", ed.openOrders, " open order(s)")), /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap gap-2 text-[11px] font-mono" }, /* @__PURE__ */ React.createElement("button", { onClick: () => {
      setEditing(ed.id);
      setDraft({ name: ed.name, roleTitle: ed.roleTitle, tag: ed.tag, email: ed.email, bio: ed.bio });
    }, className: "px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200" }, "Rename / Edit"), ed.active && /* @__PURE__ */ React.createElement("button", { onClick: () => resetCode(ed), className: "px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200" }, "New passcode"), ed.active ? /* @__PURE__ */ React.createElement("button", { onClick: () => remove(ed), className: "px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300" }, "Remove") : /* @__PURE__ */ React.createElement("button", { onClick: () => restore(ed), className: "px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300" }, "Restore"))));
  })));
}
function AdminPricing({ showAlert, onConfigChange }) {
  const [rows, setRows] = useState(RATE_CARD.map((r) => ({ ...r })));
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (id, key, value) => setEdits((prev) => ({ ...prev, [id]: { ...prev[id] || {}, [key]: value } }));
  const save = async (row) => {
    const e = edits[row.id] || {};
    const body = {};
    if (e.price !== void 0 && e.price !== "") body.price = Number(e.price);
    if (e.payout !== void 0 && e.payout !== "") body.payout = Number(e.payout);
    if (e.priceRange) body.priceRange = e.priceRange;
    if (e.payoutRange) body.payoutRange = e.payoutRange;
    if (e.turnaround) body.turnaround = e.turnaround;
    if (Object.keys(body).length === 0) {
      showAlert("Nothing To Save", "Change a value first.", "info");
      return;
    }
    setBusy(true);
    try {
      const r = await api("PUT", `/admin/rates/${row.id}`, body);
      setRows(r.rateCard);
      setEdits((prev) => ({ ...prev, [row.id]: {} }));
      if (onConfigChange) onConfigChange();
      showAlert("Prices Updated", `${row.type} now uses the new defaults for new orders.`, "success");
    } catch (err) {
      showAlert("Prices Not Saved", err.message, "error");
    }
    setBusy(false);
  };
  const input = "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono";
  return /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-4" }, /* @__PURE__ */ React.createElement("h3", { className: "text-xs font-mono text-gray-400 uppercase tracking-widest" }, "Default prices (apply to NEW orders; existing orders keep their price)"), rows.map((row) => {
    const e = edits[row.id] || {};
    return /* @__PURE__ */ React.createElement("div", { key: row.id, className: "p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2", "data-testid": `rate-${row.id}` }, /* @__PURE__ */ React.createElement("div", { className: "text-sm text-white font-bold" }, row.type, " ", /* @__PURE__ */ React.createElement("span", { className: "text-[10px] text-gray-500 font-mono" }, row.id)), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-2 md:grid-cols-5 gap-3 text-[10px] font-mono text-gray-400" }, /* @__PURE__ */ React.createElement("label", null, "Client price (USD)", /* @__PURE__ */ React.createElement("input", { type: "number", min: "1", className: input, defaultValue: row.clientPriceDefault, key: row.clientPriceDefault, onChange: (ev) => set(row.id, "price", ev.target.value) })), /* @__PURE__ */ React.createElement("label", null, "Editor payout (USD)", /* @__PURE__ */ React.createElement("input", { type: "number", min: "0", className: input, defaultValue: row.editorPayoutDefault, key: "p" + row.editorPayoutDefault, onChange: (ev) => set(row.id, "payout", ev.target.value) })), /* @__PURE__ */ React.createElement("label", null, "Price range", /* @__PURE__ */ React.createElement("input", { className: input, defaultValue: row.clientPriceRangeUSD, key: row.clientPriceRangeUSD, onChange: (ev) => set(row.id, "priceRange", ev.target.value) })), /* @__PURE__ */ React.createElement("label", null, "Payout range", /* @__PURE__ */ React.createElement("input", { className: input, defaultValue: row.editorPayoutRangeUSD, key: row.editorPayoutRangeUSD, onChange: (ev) => set(row.id, "payoutRange", ev.target.value) })), /* @__PURE__ */ React.createElement("label", null, "Turnaround", /* @__PURE__ */ React.createElement("input", { className: input, defaultValue: row.typicalTurnaround, key: row.typicalTurnaround, onChange: (ev) => set(row.id, "turnaround", ev.target.value) }))), /* @__PURE__ */ React.createElement("div", { className: "text-[10px] font-mono text-gray-500" }, "Profit range: ", row.profitRangeUSD, " (", row.profitRangeINR, ")"), /* @__PURE__ */ React.createElement("button", { disabled: busy, onClick: () => save(row), className: "px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-50" }, "Save ", row.type));
  }));
}
function AdminInquiries({ showAlert }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api("GET", "/admin/inquiries").then((r) => setRows(r.inquiries)).catch((err) => showAlert("Could Not Load Inquiries", err.message, "error"));
  }, []);
  return /* @__PURE__ */ React.createElement("div", { className: "glass-panel p-6 rounded-3xl border border-white/10 space-y-3" }, /* @__PURE__ */ React.createElement("h3", { className: "text-xs font-mono text-gray-400 uppercase tracking-widest" }, "Website inquiries ", rows ? `(${rows.length})` : ""), rows && rows.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "text-xs text-gray-400" }, "No inquiries yet."), (rows || []).map((r) => /* @__PURE__ */ React.createElement("div", { key: r.id, className: "p-3 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-gray-300 flex flex-wrap gap-x-4" }, /* @__PURE__ */ React.createElement("strong", { className: "text-white" }, r.name), /* @__PURE__ */ React.createElement("span", null, r.email), /* @__PURE__ */ React.createElement("span", null, r.phone), /* @__PURE__ */ React.createElement("span", { className: "text-gray-500" }, r.created_at))));
}
const rootElement = document.getElementById("root");
const root = ReactDOM.createRoot(rootElement);
root.render(/* @__PURE__ */ React.createElement(App, null));
