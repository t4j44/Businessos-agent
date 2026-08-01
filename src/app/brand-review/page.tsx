"use client";

import React, { useState, useEffect } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";

const LOADING_MESSAGES = [
  "Reading your homepage...",
  "Analyzing your product pages...",
  "Understanding your brand voice...",
  "Identifying your ideal customers...",
  "Building your content templates...",
  "Almost done..."
];

const MOCK_DATA = {
  company_name: "DevStack Inc",
  tone: "Technical",
  voice_description: "Expert, detailed communication style. Uses technical terminology appropriately. Direct and results-focused.",
  icp: "B2B SaaS founders and CTOs at startups with 10-100 employees building developer tools.",
  products: ["API Platform", "Developer Dashboard", "Analytics Suite"],
  competitors: ["Stripe", "Twilio", "Segment"],
  brand_colors: ["#2563EB", "#1E293B"]
};

export default function BrandReviewPage() {
  const [status, setStatus] = useState<'processing' | 'ready'>('processing');
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(0);

  // Editable Form State
  const [data, setData] = useState(MOCK_DATA);

  useEffect(() => {
    if (status !== 'processing') return;

    // Cycle through messages every 3 seconds
    const messageInterval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 3000);

    // Fake progress 0-95% over ~90 seconds (update every second)
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return 95;
        // ~1% per second gets us to 95 in ~95 seconds
        return prev + 1.05;
      });
    }, 1000);

    // Step progression (fake for visual effect)
    const stepsInterval = setInterval(() => {
      setCompletedSteps((prev) => {
        if (prev >= 3) return prev;
        return prev + 1;
      });
    }, 5000);

    // Auto transition to 'ready' after 15 seconds for demonstration purposes
    const finishTimeout = setTimeout(() => {
      setStatus('ready');
    }, 15000);

    return () => {
      clearInterval(messageInterval);
      clearInterval(progressInterval);
      clearInterval(stepsInterval);
      clearTimeout(finishTimeout);
    };
  }, [status]);

  if (status === 'processing') {
    return (
      <div className="flex h-screen w-full bg-gray-50 text-gray-900 font-sans">
        {/* Left Side Panel */}
        <div className="w-80 bg-white border-r border-gray-200 p-8 flex flex-col justify-center">
          <h2 className="text-xl font-semibold mb-6">Processing Steps</h2>
          <ul className="space-y-4 text-sm">
            <li className="flex items-center gap-3">
              {completedSteps > 0 ? <Check className="w-5 h-5 text-green-500" /> : <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
              <span className={completedSteps > 0 ? "text-gray-900" : "text-gray-500 font-medium"}>Website read (12 pages)</span>
            </li>
            <li className="flex items-center gap-3">
              {completedSteps > 1 ? <Check className="w-5 h-5 text-green-500" /> : (completedSteps === 1 ? <Loader2 className="w-5 h-5 animate-spin text-blue-500" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-200" />)}
              <span className={completedSteps > 1 ? "text-gray-900" : (completedSteps === 1 ? "text-gray-500 font-medium" : "text-gray-400")}>Brand voice identified</span>
            </li>
            <li className="flex items-center gap-3">
              {completedSteps > 2 ? <Check className="w-5 h-5 text-green-500" /> : (completedSteps === 2 ? <Loader2 className="w-5 h-5 animate-spin text-blue-500" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-200" />)}
              <span className={completedSteps > 2 ? "text-gray-900" : (completedSteps === 2 ? "text-gray-500 font-medium" : "text-gray-400")}>ICP extracted</span>
            </li>
            <li className="flex items-center gap-3">
               {completedSteps > 3 ? <Check className="w-5 h-5 text-green-500" /> : (completedSteps === 3 ? <Loader2 className="w-5 h-5 animate-spin text-blue-500" /> : <div className="w-5 h-5 rounded-full border-2 border-gray-200" />)}
              <span className={completedSteps > 2 ? "text-blue-600 font-medium" : "text-gray-400"}>{completedSteps > 2 ? "Building email templates..." : "Email templates pending"}</span>
            </li>
            <li className="flex items-center gap-3 text-gray-400">
               <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
              <span>Content calendar pending</span>
            </li>
            <li className="flex items-center gap-3 text-gray-400">
               <div className="w-5 h-5 rounded-full border-2 border-gray-200" />
              <span>Agent training pending</span>
            </li>
          </ul>
        </div>

        {/* Center Screen */}
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="relative flex items-center justify-center w-32 h-32 mb-8">
            <svg className="animate-spin w-full h-full text-blue-500" viewBox="0 0 50 50">
              <circle className="path" cx="25" cy="25" r="20" fill="none" strokeWidth="4" stroke="currentColor" strokeDasharray="90 150" strokeLinecap="round"></circle>
            </svg>
            <div className="absolute text-xl font-semibold text-gray-700">{Math.floor(progress)}%</div>
          </div>
          
          <h3 className="text-2xl font-bold text-gray-800 mb-4 h-8 animate-pulse">
            {LOADING_MESSAGES[messageIndex]}
          </h3>
          
          <div className="w-full max-w-md bg-gray-200 rounded-full h-2.5 mb-2 overflow-hidden">
            <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-1000 ease-linear" style={{ width: `${progress}%` }}></div>
          </div>
          <p className="text-gray-500 text-sm mt-4">This usually takes 5-10 minutes</p>
          
          <button onClick={() => setStatus('ready')} className="mt-8 text-xs text-gray-400 underline hover:text-gray-600">
            [Dev: Skip Loading]
          </button>
        </div>
      </div>
    );
  }

  // Helper for updating items in arrays
  const updateArray = (key: 'products' | 'competitors', index: number, val: string) => {
    const newArr = [...data[key]];
    newArr[index] = val;
    setData({ ...data, [key]: newArr });
  };
  
  const addToArray = (key: 'products' | 'competitors') => {
    setData({ ...data, [key]: [...data[key], ""] });
  };

  const removeFromArray = (key: 'products' | 'competitors', index: number) => {
    const newArr = [...data[key]];
    newArr.splice(index, 1);
    setData({ ...data, [key]: newArr });
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="text-center mb-10">
          <h1 className="text-3xl font-extrabold text-gray-900">Your brand profile is ready</h1>
          <p className="mt-2 text-lg text-gray-600">Review and edit before activating your agents.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CARD 1 - Company Identity */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Company Identity</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Company Name</label>
                <input 
                  type="text" 
                  value={data.company_name} 
                  onChange={(e) => setData({...data, company_name: e.target.value})}
                  className="w-full border-b border-gray-200 focus:border-blue-500 outline-none pb-1 font-medium"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Website URL</label>
                <div className="text-sm text-gray-500 font-mono bg-gray-50 p-2 rounded">https://devstack.io</div>
              </div>
              <div>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  B2B SaaS
                </span>
              </div>
            </div>
          </div>

          {/* CARD 2 - Brand Voice */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Brand Voice</h3>
            <div className="space-y-4">
              <div>
                 <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 mb-2">
                  {data.tone}
                </span>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Voice Description</label>
                <textarea 
                  value={data.voice_description} 
                  onChange={(e) => setData({...data, voice_description: e.target.value})}
                  className="w-full text-sm border border-gray-200 rounded p-2 focus:border-blue-500 outline-none h-24 resize-none"
                />
              </div>
              <div className="bg-gray-50 border-l-4 border-purple-400 p-3 italic text-xs text-gray-600">
                "Our robust API platform seamlessly integrates to accelerate your development lifecycle."
              </div>
            </div>
          </div>

          {/* CARD 3 - ICP */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 md:col-span-2 text-sm">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center justify-between">
              Your Ideal Customer (ICP)
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">Who Hunter will target</span>
            </h3>
            <textarea 
              value={data.icp} 
              onChange={(e) => setData({...data, icp: e.target.value})}
              className="w-full text-base border border-gray-200 rounded p-3 focus:border-blue-500 outline-none h-20"
            />
          </div>

          {/* CARD 4 - Products & Services */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
             <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Products & Services</h3>
             <ul className="space-y-2">
               {data.products.map((prod, idx) => (
                 <li key={idx} className="flex items-center gap-2">
                   <div className="h-2 w-2 bg-blue-500 rounded-full" />
                   <input 
                     value={prod} 
                     onChange={(e) => updateArray('products', idx, e.target.value)} 
                     className="flex-1 text-sm border-b border-transparent hover:border-gray-200 focus:border-blue-500 outline-none px-1"
                   />
                   <button onClick={() => removeFromArray('products', idx)} className="text-gray-400 hover:text-red-500 p-1"><X className="w-4 h-4" /></button>
                 </li>
               ))}
             </ul>
             <button onClick={() => addToArray('products')} className="mt-4 flex items-center text-sm text-blue-600 hover:text-blue-800 transition-colors">
               <Plus className="w-4 h-4 mr-1" /> Add product
             </button>
          </div>

          {/* CARD 5 - Competitors */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
             <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Competitors Detected</h3>
             <ul className="space-y-2">
               {data.competitors.map((comp, idx) => (
                 <li key={idx} className="flex items-center gap-2">
                   <div className="h-2 w-2 bg-orange-400 rounded-full" />
                   <input 
                     value={comp} 
                     onChange={(e) => updateArray('competitors', idx, e.target.value)} 
                     className="flex-1 text-sm border-b border-transparent hover:border-gray-200 focus:border-blue-500 outline-none px-1"
                   />
                   <button onClick={() => removeFromArray('competitors', idx)} className="text-gray-400 hover:text-red-500 p-1"><X className="w-4 h-4" /></button>
                 </li>
               ))}
             </ul>
             <button onClick={() => addToArray('competitors')} className="mt-4 flex items-center text-sm text-blue-600 hover:text-blue-800 transition-colors">
               <Plus className="w-4 h-4 mr-1" /> Add competitor
             </button>
          </div>

          {/* CARD 6 - Brand Colors */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 md:col-span-2">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Brand Colors</h3>
            <div className="flex gap-4 items-center">
              {data.brand_colors.map((color, idx) => (
                <div key={idx} className="flex flex-col items-center gap-2">
                   <div className="w-12 h-12 rounded shadow-inner cursor-pointer border border-gray-200 flex items-center justify-center overflow-hidden">
                     <input type="color" value={color} onChange={(e) => {
                       const newColors = [...data.brand_colors];
                       newColors[idx] = e.target.value;
                       setData({...data, brand_colors: newColors});
                     }} className="w-20 h-20 -m-4 cursor-pointer" />
                   </div>
                   <span className="text-xs text-gray-500 font-mono uppercase">{color}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* BOTTOM ACTIONS */}
        <div className="mt-12 space-y-4 pt-8 border-t border-gray-200">
           <h3 className="text-xl font-medium text-center text-gray-900 mb-6">Looks good?</h3>
           <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
             <button className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition-colors w-full sm:w-auto text-lg">
               Activate Agents
             </button>
             <button className="px-8 py-4 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium rounded-lg shadow-sm transition-colors w-full sm:w-auto">
               Need changes? Edit & Re-scan
             </button>
           </div>
        </div>
      </div>
    </div>
  );
}