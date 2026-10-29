// Tailwind CDN settings (moved out of index.html so the page can run without inline scripts).
tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        obsidian: '#06070A',
                        surface: '#0D0E12',
                        card: '#12141C',
                        border: 'rgba(255, 255, 255, 0.08)',
                        primary: '#3B82F6',
                        emeraldAccent: '#10B981',
                        purpleAccent: '#8B5CF6'
                    },
                    fontFamily: {
                        sans: ['Inter', 'sans-serif'],
                        mono: ['JetBrains Mono', 'monospace']
                    }
                }
            }
        }
