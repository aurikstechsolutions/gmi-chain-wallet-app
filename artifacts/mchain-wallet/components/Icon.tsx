import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  AtSign,
  Award,
  BarChart2,
  Box,
  Camera,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleArrowDown,
  CircleArrowUp,
  CircleX,
  Clipboard,
  Clock,
  CloudUpload,
  Copy,
  Cpu,
  CreditCard,
  Bell,
  BellOff,
  Delete,
  Diamond,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FingerprintPattern,
  GitBranch,
  Globe,
  Home,
  Images,
  Info,
  Key,
  Link,
  Lock,
  LockOpen,
  LogOut,
  MapPin,
  Menu,
  PauseCircle,
  Pencil,
  Phone,
  PlusCircle,
  Receipt,
  RefreshCw,
  Repeat,
  ScanLine,
  Search,
  Send,
  Server,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  ShieldOff,
  Star,
  Store,
  Trash2,
  TrendingUp,
  Trophy,
  Unlink,
  User,
  Users,
  Wallet,
  Wifi,
  X,
  Zap,
} from "lucide-react-native";
import React from "react";
import { type LucideProps } from "lucide-react-native";

type LucideIcon = React.ComponentType<LucideProps>;

const MAP: Record<string, LucideIcon> = {
  // activity / status
  "activity": Activity,
  "pulse-outline": Activity,

  // alerts
  "alert-circle": AlertCircle,
  "alert-circle-outline": AlertCircle,
  "alert-triangle": AlertTriangle,
  "warning-outline": AlertTriangle,

  // bell / notifications
  "bell": Bell,
  "bell-outline": Bell,
  "notifications-outline": Bell,
  "bell-off": BellOff,

  // backspace / delete
  "backspace-outline": Delete,
  "backspace": Delete,

  // arrows / navigation
  "arrow-back": ArrowLeft,
  "arrow-forward": ArrowRight,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  "arrow-up-circle-outline": CircleArrowUp,
  "arrow-down-circle-outline": CircleArrowDown,
  "chevron-forward": ChevronRight,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "chevron-down": ChevronDown,

  // at / identity
  "at-circle-outline": AtSign,

  // award / medal
  "medal-outline": Award,
  "trophy-outline": Trophy,

  // camera
  "camera-outline": Camera,

  // check / close
  "checkmark": Check,
  "checkmark-circle": CheckCircle,
  "checkmark-circle-outline": CheckCircle,
  "close": X,
  "close-circle": CircleX,
  "x": X,

  // card / credit card
  "card": CreditCard,
  "card-outline": CreditCard,

  // clipboard / copy
  "clipboard": Clipboard,
  "clipboard-outline": Clipboard,
  "copy": Copy,
  "copy-outline": Copy,

  // clock / time
  "clock": Clock,
  "time-outline": Clock,

  // cloud
  "cloud-upload-outline": CloudUpload,

  // cpu / hardware
  "cpu": Cpu,
  "hardware-chip-outline": Cpu,

  // data
  "bar-chart": BarChart2,
  "bar-chart-outline": BarChart2,

  // diamond / gem
  "diamond-outline": Diamond,

  // document / file
  "document-outline": FileText,
  "document-text-outline": FileText,

  // download
  "download": Download,
  "download-outline": Download,

  // edit / pencil
  "create-outline": Edit2,
  "edit-2": Edit2,
  "pencil-outline": Pencil,

  // eye
  "eye": Eye,
  "eye-outline": Eye,
  "eye-off": EyeOff,
  "eye-off-outline": EyeOff,

  // fingerprint
  "finger-print-outline": FingerprintPattern,

  // flash / zap
  "flash-outline": Zap,
  "zap": Zap,

  // geo / location
  "location-outline": MapPin,

  // git
  "git-branch-outline": GitBranch,
  "git-compare-outline": GitBranch,

  // globe / network
  "globe": Globe,
  "globe-outline": Globe,

  // home
  "home": Home,
  "home-outline": Home,

  // images
  "images-outline": Images,

  // info
  "information-circle-outline": Info,

  // key
  "key-outline": Key,

  // link
  "link-outline": Link,

  // lock
  "lock": Lock,
  "lock-closed": Lock,
  "lock-closed-outline": Lock,
  "lock-open-outline": LockOpen,

  // log out / disconnect
  "log-out-outline": LogOut,

  // menu
  "menu": Menu,

  // cube/box
  "box": Box,
  "cube-outline": Box,

  // open / external link
  "open-outline": ExternalLink,

  // paper plane / send
  "paper-plane-outline": Send,
  "send": Send,

  // pause
  "pause-circle-outline": PauseCircle,

  // people / users
  "people-outline": Users,
  "person-circle-outline": User,

  // phone
  "phone-portrait-outline": Phone,

  // plus
  "add-circle-outline": PlusCircle,
  "plus-circle": PlusCircle,

  // receipt
  "receipt-outline": Receipt,

  // refresh / repeat
  "refresh-outline": RefreshCw,
  "refresh-cw": RefreshCw,
  "repeat": Repeat,
  "repeat-outline": Repeat,

  // scan
  "scan": ScanLine,

  // search
  "search": Search,
  "search-outline": Search,

  // server
  "server-outline": Server,

  // settings
  "settings": Settings,
  "settings-outline": Settings,

  // share
  "share-social-outline": Share2,

  // shield
  "shield": Shield,
  "shield-outline": Shield,
  "shield-checkmark-outline": ShieldCheck,
  "shield-half-outline": ShieldOff,

  // star
  "star": Star,
  "star-outline": Star,

  // store / storefront
  "storefront-outline": Store,

  // trending
  "trending-up": TrendingUp,
  "trending-up-outline": TrendingUp,

  // swap
  "swap-horizontal": ArrowLeftRight,
  "swap-horizontal-outline": ArrowLeftRight,

  // trash
  "trash-outline": Trash2,

  // unlink
  "unlink-outline": Unlink,

  // wallet
  "wallet": Wallet,
  "wallet-outline": Wallet,

  // wifi
  "wifi-outline": Wifi,
};

type Props = {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: LucideProps["style"];
};

export function Icon({ name, size = 20, color = "#FFFFFF", strokeWidth = 1.75, style }: Props) {
  const Component = MAP[name];
  if (!Component) {
    if (__DEV__) console.warn(`Icon: unknown name "${name}"`);
    return null;
  }
  return <Component size={size} color={color} strokeWidth={strokeWidth} style={style} />;
}
