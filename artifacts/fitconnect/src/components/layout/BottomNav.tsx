import React from 'react';
import { Link, useLocation } from 'wouter';
import { Home, MessageCircle, Activity, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function BottomNav() {
  const [location] = useLocation();
  const { t } = useTranslation();

  const navItems = [
    { href: '/', label: t('nav.home'), icon: Home },
    { href: '/coach', label: t('nav.coach'), icon: MessageCircle },
    { href: '/track', label: t('nav.track'), icon: Activity },
    { href: '/walk', label: t('nav.walk'), icon: MapPin },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 h-16 bg-card border-t border-border flex justify-around items-center px-4 pb-safe z-50 shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
      {navItems.map((item) => {
        const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
        const Icon = item.icon;
        
        return (
          <Link key={item.href} href={item.href} className="flex flex-col items-center justify-center w-16 h-full gap-1 outline-none">
            <div className={`p-1.5 rounded-full transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>
              <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
            </div>
            <span className={`text-[10px] font-medium ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
