/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, {useState, useCallback} from 'react';
import {GoogleGenAI, Type} from '@google/genai';
import * as mammoth from 'mammoth';
import {ErrorModal} from './components/ErrorModal';

// Initialize the Gemini AI model
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

// Define the structure for a generated question
interface Question {
  question: string;
  options: string[];
  correctAnswer: string;
}

// Define the structure for the state of a question in the UI
interface QuestionState extends Question {
  id: number;
  explanation: string;
  image: string | null;
  marks: 1 | 2;
}

// --- Helper Functions ---
/**
 * Extracts text from a DOCX file.
 * @param file The DOCX file.
 * @returns A promise that resolves to the extracted text.
 */
async function extractTextFromDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({arrayBuffer});
  return result.value;
}

/**
 * Extracts text from a PDF file.
 * @param file The PDF file.
 * @returns A promise that resolves to the extracted text.
 */
async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
  // @ts-ignore
  const pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
  }
  return fullText;
}

/**
 * Main application component.
 */
export const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<QuestionState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState<string[] | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setQuestions([]);
    }
  };

  const handleGenerate = async () => {
    if (!file) {
      setError(['Please select a file first.']);
      return;
    }

    setIsLoading(true);
    setError(null);
    setQuestions([]);

    try {
      // Step 1: Extract text from the uploaded file
      setLoadingStatus('Extracting text from document...');
      let extractedText = '';
      if (
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.name.endsWith('.docx') ||
        file.name.endsWith('.doc')
      ) {
        extractedText = await extractTextFromDocx(file);
      } else if (file.type === 'application/pdf') {
        extractedText = await extractTextFromPdf(file);
      } else {
        throw new Error('Unsupported file type. Please upload a PDF, DOC, or DOCX file.');
      }
      
      if (!extractedText.trim()) {
        throw new Error('Could not extract any text from the document. It might be empty or scanned as an image.');
      }

      // Step 2: Generate questions using the Gemini API
      setLoadingStatus('Generating questions with AI...');
      const prompt = `Based on the following text, generate 5 multiple-choice questions suitable for a quiz. For each question, provide 4 distinct options and clearly indicate the correct answer. The text is:\n\n---\n${extractedText.substring(0, 20000)}\n---`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: {type: Type.STRING, description: 'The question text.'},
                options: {
                  type: Type.ARRAY,
                  items: {type: Type.STRING},
                  description: 'An array of 4 possible answers.'
                },
                correctAnswer: {
                  type: Type.STRING,
                  description: 'The exact string of the correct answer from the options array.'
                },
              },
              required: ['question', 'options', 'correctAnswer'],
            },
          },
        },
      });

      const generatedQuestions: Question[] = JSON.parse(response.text);

      // Step 3: Initialize state for the UI
      setQuestions(generatedQuestions.map((q, index) => ({
        ...q,
        id: index,
        explanation: '',
        image: null,
        marks: 1,
      })));

    } catch (e: any) {
      console.error(e);
      setError([e.message || 'An unexpected error occurred.']);
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const handleQuestionChange = (id: number, field: keyof QuestionState, value: any) => {
    setQuestions(prev => prev.map(q => q.id === id ? {...q, [field]: value} : q));
  };
  
  const handleQuestionImageChange = (id: number, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        handleQuestionChange(id, 'image', event.target!.result as string);
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };


  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 text-transparent bg-clip-text">
            Doc-to-Quiz AI
          </h1>
          <p className="text-gray-400 mt-2 text-lg">
            Upload a document, and let AI create a quiz for you.
          </p>
        </header>

        <main className="space-y-6">
          <div className="bg-gray-800/50 p-6 rounded-lg shadow-lg">
            <div className="flex flex-col sm:flex-row gap-4">
              <label htmlFor="file-upload" className="flex-1 cursor-pointer bg-gray-900 border-2 border-dashed border-gray-700 rounded-lg flex items-center justify-center h-16 hover:bg-gray-800 hover:border-purple-500 transition-colors duration-300 px-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-500 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                <span className="text-gray-400 truncate">{file ? file.name : 'Upload a .pdf, .doc, or .docx file'}</span>
              </label>
              <input id="file-upload" type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
              <button onClick={handleGenerate} disabled={isLoading || !file} className="px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed h-16 flex items-center justify-center w-full sm:w-auto">
                {isLoading ? 'Generating...' : 'Generate Quiz'}
              </button>
            </div>
          </div>
          
          {isLoading && (
            <div className="text-center p-6 bg-gray-800/50 rounded-lg">
              <div className="w-8 h-8 border-2 border-dashed rounded-full animate-spin border-purple-500 mx-auto"></div>
              <p className="text-gray-400 mt-4">{loadingStatus}</p>
            </div>
          )}

          {questions.length > 0 && (
            <div className="space-y-6 animate-fade-in">
              {questions.map((q, index) => (
                <div key={q.id} className="bg-gray-800/50 p-6 rounded-lg shadow-lg space-y-4">
                  <p className="font-semibold text-lg text-white">{index + 1}. {q.question}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {q.options.map((option, i) => (
                      <div key={i} className={`p-3 rounded-md text-sm ${option === q.correctAnswer ? 'bg-green-500/20 text-green-300 ring-1 ring-green-500' : 'bg-gray-700/50'}`}>
                        {option}
                      </div>
                    ))}
                  </div>
                  
                  <div className="border-t border-gray-700 pt-4 space-y-4">
                    <div>
                      <label htmlFor={`explanation-${q.id}`} className="block text-sm font-medium text-gray-300 mb-1">Explanation</label>
                      <textarea id={`explanation-${q.id}`} rows={2} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-1 focus:ring-purple-500 focus:border-purple-500" value={q.explanation} onChange={e => handleQuestionChange(q.id, 'explanation', e.target.value)} placeholder="Add an optional explanation..."/>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                      <div>
                        <label htmlFor={`image-${q.id}`} className="block text-sm font-medium text-gray-300 mb-1">Supporting Image</label>
                        <input id={`image-${q.id}`} type="file" onChange={e => handleQuestionImageChange(q.id, e)} accept="image/*" className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-600/20 file:text-purple-300 hover:file:bg-purple-600/30"/>
                        {q.image && <img src={q.image} alt="preview" className="mt-2 rounded-md max-h-32"/>}
                      </div>
                      <div>
                        <label htmlFor={`marks-${q.id}`} className="block text-sm font-medium text-gray-300 mb-1">Marks</label>
                        <select id={`marks-${q.id}`} value={q.marks} onChange={e => handleQuestionChange(q.id, 'marks', parseInt(e.target.value))} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-gray-200 focus:ring-1 focus:ring-purple-500 focus:border-purple-500">
                          <option value="1">1 Mark</option>
                          <option value="2">2 Marks</option>
                        </select>
                      </div>
                    </div>
                  </div>

                </div>
              ))}
            </div>
          )}
        </main>
      </div>
      {error && <ErrorModal message={error} onClose={() => setError(null)} onSelectKey={async () => await window.aistudio?.openSelectKey()}/>}
    </div>
  );
};
