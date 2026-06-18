"use client";

import { format, addMonths, subMonths } from "date-fns";

interface Props {
  currentMonth: Date;
  onChange: (date: Date) => void;
}

export default function MonthPicker({ currentMonth, onChange }: Props) {
  return (
    <div className="flex items-center gap-4">
      <button
        onClick={() => onChange(subMonths(currentMonth, 1))}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      <h1 className="text-xl font-bold text-gray-800 min-w-[180px] text-center">
        {format(currentMonth, "MMMM yyyy")}
      </h1>
      <button
        onClick={() => onChange(addMonths(currentMonth, 1))}
        className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}
