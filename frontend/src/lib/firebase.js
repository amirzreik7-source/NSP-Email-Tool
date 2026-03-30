import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyASZRtqfsVr53MlcR7kVbCDoCc0INusueo",
  authDomain: "northern-star-painters.firebaseapp.com",
  projectId: "northern-star-painters",
  storageBucket: "northern-star-painters.firebasestorage.app",
  messagingSenderId: "373144633102",
  appId: "1:373144633102:web:4c3451cc855e8f8ff1215f"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export { signInWithEmailAndPassword, signInWithPopup, signOut, onAuthStateChanged };
