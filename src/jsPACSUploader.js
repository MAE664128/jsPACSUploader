window.dicomParser || document.write('<script src="https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js">\x3C/script>')


function isDirectoryPickerAvailable() {
    return Boolean(window.showDirectoryPicker);
}

async function selectFolder() {
    if (isDirectoryPickerAvailable()) {
        try {
            return await window.showDirectoryPicker();
        } catch (e) {
            console.error(e.name, e.message);
            throw new Error('Не удалось прочитать папку: ' + e.message);
        }
    } else {
        throw new Error('Ваш браузер не поддерживает работу с файловой системой.');
    }
}

function sleep(millis) {
    return new Promise(resolve => setTimeout(resolve, millis));
}

async function fetchWithRetries(url, options = {}, retries = 3) {
    let response;
    let is_err = false;
    let msg = "";
    try {
        response = await fetch(url, options);
        if (response.status !== 200) {
            is_err = true;
            msg = response.status
        }
    } catch (err) {
        is_err = true;
        msg = err.message
    }
    if (is_err) {
        if (retries > 0) {
            await sleep(100);
            return await fetchWithRetries(url, options, retries - 1)
        }
        throw new Error(msg)
    } else {
        return response;
    }
}

/**
 * Генератор возвращающий дескрипторы к файлам в файловой системе, которые расположены в указанном каталоге и в его подкаталогах.
 * @param {FileSystemDirectoryHandle} dirHandle - HTML элемент внутрь которого будет выполнен рендер интерфейса.
 */
async function* getFileHandlesByDirHandle(dirHandle) {
    for await (let entry of dirHandle.values()) {
        if (entry.kind === 'file') {
            yield entry;
        } else if (entry.kind === 'directory') {
            yield* getFileHandlesByDirHandle(entry);
        }
    }
}

let anonTags = [
    "x00100010", // Patient Name
    "x00101010", // PatientAge
    "x00080081", // InstitutionAddress
    "x00100034", // PatientDeathDateInAlternativeCalendar
    "x00104000", // PatientComments
    "x00401102", // PersonAddress
    "x00080080", // InstitutionName
    "x00102297", // ResponsiblePerson
    "x00380010", // AdmissionID
    "x00181000", // DeviceSerialNumber
    "x00500020", // DeviceDescription
    "x00401103", // PersonTelephoneNumbers
]

/**
 * Выполнить деперсонализацию DICOM и отправить из на сервер POST запросом по указанной ссылке.
 * @param {FileSystemFileHandle} fileHandle - Дескриптор файла в файловой системе.
 * @param {string} urlForPostRequest - Адрес на который нужно выполнить POST запрос.
 * @return {Promise} result - Содержимое объекта меняется в зависимости от результата.
 * В случаи успеха:
 * ```
 * result = {
 *  isSuccessful: true,
 *  data: {
 *      studyInstanceUid: studyInstanceUid,
 *      seriesInstanceUid: seriesInstanceUid,
 *      modality: modality,
 *      sopInstanceUid: sopInstanceUid
 * }
 * ```
 *
 * В случаи провала:
 * ```
 * result = {
 *     isSuccessful: false,
 *     msg: ""
 * }
 * ```
 */
async function anonymizeDataSetAndSendToUrl(fileHandle, urlForPostRequest) {
    try {
        const result = await fileHandle.getFile();
        const arrayBuffer = await result.arrayBuffer();
        const byteArray = new Uint8Array(arrayBuffer);
        try {
            let dataSet = window.dicomParser.parseDicom(byteArray);
            anonTags.forEach(tag => {
                let newValue = "";
                const element = dataSet.elements[tag];
                if (typeof element !== "undefined") {
                    const str = dataSet.string(tag);
                    if (str !== undefined) {
                        newValue = '0'.repeat(str.length);
                    }
                    for (let i = 0; i < element.length; i++) {
                        dataSet.byteArray[element.dataOffset + i] = (newValue.length > i) ? newValue.charCodeAt(i) : 32;
                    }
                }
            })
            const studyInstanceUid = dataSet.string('x0020000d');
            const seriesInstanceUid = dataSet.string('x0020000e');
            const modality = dataSet.string('x00080060');
            const sopInstanceUid = dataSet.string('x00080018');
            const blob = new Blob([dataSet.byteArray], {type: "application/dicom"});

            try {
                const response = await fetchWithRetries(urlForPostRequest, {
                    method: "POST",
                    credentials: "include",
                    body: blob
                });
                if (response.status !== 200) {
                    return {
                        isSuccessful: false,
                        msg: "Запрос на отправку вернул статус " + response.status
                    };
                } else {
                    return {
                        isSuccessful: true,
                        data: {
                            studyInstanceUid: studyInstanceUid,
                            seriesInstanceUid: seriesInstanceUid,
                            modality: modality,
                            sopInstanceUid: sopInstanceUid
                        }
                    };
                }
            } catch (err) {
                return {
                    isSuccessful: false,
                    msg: "Запрос завершился не успешно: " + err.message
                };
            }
        } catch (err) {
            return {
                isSuccessful: false,
                msg: "Не удалось прочитать DICOM файл: " + err.message
            };
        }
    } catch (err) {
        return {
            isSuccessful: false,
            msg: "Не удалось получить доступ к файлу: " + err.message
        };
    }
}


function CurrentProgressSendText(count, total) {
    const position = Math.floor(count / total * 100);
    const row = document.createElement("div");
    row.setAttribute("id", "currentProgressSendText");
    row.classList.add("row", "row-cols-1", "justify-content-center");
    const colText = document.createElement("div");
    colText.classList.add("col", "text-center");
    const span = document.createElement("span");
    span.classList.add("badge", "rounded-pill", "bg-light", "text-dark")
    span.appendChild(document.createTextNode(position.toString() + "%"));
    span.style.fontSize = "17pt";
    colText.appendChild(span);

    const progress = document.createElement("div");
    const progressBar = document.createElement("div");
    progressBar.classList.add("progress-bar");
    progressBar.setAttribute("aria-valuenow", position.toString());
    progressBar.setAttribute("aria-valuemin", "0");
    progressBar.setAttribute("aria-valuemax", "100");
    if (position !== 0) {
        progressBar.style.width = position.toString() + "%";
    }
    progress.appendChild(progressBar);
    progress.classList.add("col", "progress");
    row.appendChild(colText);
    row.appendChild(progress);
    return row;
}

function CurrentNumberOfFilesThatHaveBeenScannedText(count) {
    const row = document.createElement("div");
    row.setAttribute("id", "currentNumberOfFilesThatHaveBeenScanned");
    row.classList.add("row", "row-cols-1", "justify-content-center");
    const col = document.createElement("div");
    col.classList.add("col", "text-center");
    const span = document.createElement("span");
    span.classList.add("badge", "rounded-pill", "bg-light", "text-dark")
    span.appendChild(document.createTextNode(count));
    span.style.fontSize = "17pt";
    col.appendChild(span);
    const colText = document.createElement("div");
    colText.appendChild(document.createTextNode("найдено файлов"));
    colText.classList.add("col", "text-center");
    row.appendChild(col);
    row.appendChild(colText);
    return row;
}

function TemplateCardBlock({
                               id,
                               title,
                               info,
                               activeEl = [],
                               textBtnPrevious = "Назад",
                               callbackPrevious = undefined,
                               textBtnNext = "Продолжить",
                               callbackNext = undefined
                           }
) {
    const card = document.createElement("div");
    card.setAttribute("id", id);
    const cardHeader = document.createElement("div");
    const textHeader = document.createElement("h5");
    card.classList.add("card", "h-100");
    cardHeader.classList.add("card-header");
    textHeader.classList.add("text-truncate");
    textHeader.innerText = title;
    cardHeader.appendChild(textHeader);
    card.appendChild(cardHeader);
    const cardBody = document.createElement("div");
    cardBody.classList.add("card-body", "overflow-auto");
    const textInfo = document.createElement("p");
    textInfo.classList.add("card-text");
    textInfo.appendChild(document.createTextNode(info));
    cardBody.appendChild(textInfo);
    if (Array.isArray(activeEl)) {
        for (const el of activeEl) {
            if (typeof el !== "undefined") {
                cardBody.appendChild(el);
            }
        }
    }
    card.appendChild(cardBody);
    const cardFooter = document.createElement("div");
    cardFooter.classList.add("card-footer", "d-flex", "justify-content-end");
    const cardBtnPrevious = document.createElement("button");
    cardBtnPrevious.setAttribute("type", "button");
    cardBtnPrevious.classList.add("btn", "btn-secondary", "btn-sm", "mx-1");
    cardBtnPrevious.appendChild(document.createTextNode(textBtnPrevious));
    if (typeof callbackPrevious !== "undefined") {
        cardBtnPrevious.addEventListener('click', callbackPrevious);
        cardFooter.appendChild(cardBtnPrevious);
    }
    const cardBtnNext = document.createElement("button");
    cardBtnNext.setAttribute("type", "button");
    cardBtnNext.classList.add("btn", "btn-outline-danger", "btn-sm", "mx-1");
    cardBtnNext.appendChild(document.createTextNode(textBtnNext));
    if (typeof callbackNext !== "undefined") {
        cardBtnNext.addEventListener('click', callbackNext);
        cardFooter.appendChild(cardBtnNext);
    }
    card.appendChild(cardFooter);
    return card
}


function DcmStudySetBlock(dcmFileSet, callbackCheckBox, limitOnNumberOfStudies) {
    const callback = (evt) => {
        let result = new Set();
        if (evt.target.checked) {
            result.add(evt.target.value);
        }
        const inputs = document.querySelectorAll("input[id*='accordionCheckBoxForButtonUid']");
        let count = result.size;
        inputs.forEach((el) => {
            if (el !== evt.target && el.checked) {
                count = count + 1;
                if (count <= limitOnNumberOfStudies) {
                    result.add(el.value);
                } else {
                    el.checked = false;
                }
            }
        });
        callbackCheckBox(result);
    }

    const container = document.createElement("div");
    container.classList.add("container");
    container.classList.add("text-center");
    if (dcmFileSet.studies.size === 0) {
        const infoEl = document.createElement("h5");
        infoEl.setAttribute("class", "text-secondary");
        const textInfoEl = document.createTextNode(
            "К сожалению, в указанной директории не были найдены медицинские изображения."
        );
        infoEl.appendChild(textInfoEl);
        container.appendChild(infoEl);
    } else {
        const accordion = document.createElement("div");
        accordion.setAttribute("class", "accordion");
        accordion.setAttribute("id", "DcmStudySetBlock");
        for (let study of dcmFileSet.studies.values()) {
            let studyUid = study.uid.replaceAll(".", '');
            const accordionItem = document.createElement("div");
            const headingAccordionItem = document.createElement("h2");
            const accordionButton = document.createElement("button");
            const accordionCheckBoxForButton = document.createElement("input");
            const collapseAccordionItem = document.createElement("div");
            const accordionBody = document.createElement("div");
            const spanForStudyDescription = document.createElement("span");
            const studyDescription = document.createTextNode(
                '#' + study.num + '\t-\t' + study.description + '\t-\t' + Array.from(study.modality).join(' ') + '\t-\t(' + study.create_at + ')'
            );
            const number_of_series = study.number_of_series;
            const number_of_files = study.number_of_files;

            const seriesDescriptions1 = document.createTextNode(
                "Количество серий в исследовании: " + number_of_series
            );
            const seriesDescriptions2 = document.createTextNode(
                "Количество dicom файлов: " + number_of_files
            );
            accordionItem.setAttribute("class", "accordion-item");
            headingAccordionItem.setAttribute("class", "accordion-header");
            accordionButton.setAttribute("class", "accordion-button collapsed");
            accordionButton.setAttribute("type", "button");
            accordionButton.setAttribute("data-bs-toggle", "collapse");
            accordionButton.setAttribute("data-bs-target", "#collapseForStudy-" + studyUid);
            accordionButton.setAttribute("aria-expanded", "false");
            accordionButton.setAttribute("aria-controls", "collapseForStudy-" + studyUid);
            spanForStudyDescription.setAttribute("class", "text-truncate");
            spanForStudyDescription.setAttribute("style", "min-wi");
            spanForStudyDescription.style.minWidth = "14px";
            accordionCheckBoxForButton.setAttribute("class", "form-check-input me-2");
            accordionCheckBoxForButton.setAttribute("type", "checkbox");
            accordionCheckBoxForButton.setAttribute("value", study.uid);
            accordionCheckBoxForButton.setAttribute("id", "accordionCheckBoxForButtonUid-" + studyUid);
            accordionCheckBoxForButton.addEventListener('change', callback);
            collapseAccordionItem.setAttribute("id", "collapseForStudy-" + studyUid);
            collapseAccordionItem.setAttribute("class", "accordion-collapse collapse");
            collapseAccordionItem.setAttribute("data-bs-parent", "#DcmStudySetBlock");
            accordionBody.setAttribute("class", "accordion-body");
            accordion.appendChild(accordionItem);
            accordionItem.appendChild(headingAccordionItem);
            headingAccordionItem.appendChild(accordionButton);
            accordionButton.appendChild(accordionCheckBoxForButton);
            spanForStudyDescription.appendChild(studyDescription);
            accordionButton.appendChild(spanForStudyDescription);
            accordionItem.appendChild(collapseAccordionItem);
            collapseAccordionItem.appendChild(accordionBody);
            accordionBody.appendChild(seriesDescriptions1);
            accordionBody.appendChild(document.createElement("br"));
            accordionBody.appendChild(seriesDescriptions2);
        }
        const hrEl = document.createElement("hr");
        accordion.appendChild(hrEl);
        container.appendChild(accordion);
    }
    return container;
}


class DcmImageInstances {
    constructor(fileHandle) {
        this.fileHandle = fileHandle;
        this.name = fileHandle.name;
    }
}

class DcmSeries {
    constructor(seriesUid, modality, seriesDescription) {
        this.seriesUid = seriesUid;
        this.description = seriesDescription;
        this.modality = modality;
        this.imageInstances = [];
    }

    pushImageInstances(imageInstance) {
        this.imageInstances.push(imageInstance);
    }
}

class DcmStudy {
    constructor(num, studyUid, studyDate, studyDescription, modality) {
        this.num = num;
        this.uid = studyUid;
        this.create_at = studyDate;
        this.description = studyDescription;
        this.modality = new Set();
        this.modality.add(modality);
        this.series = new Map();
    }

    get number_of_series() {
        return this.series.size;
    }

    get imageInstances() {
        let imageInstances = [];
        this.series.forEach((series) => {
            imageInstances = imageInstances.concat(series.imageInstances);
        });
        return imageInstances;
    }

    get number_of_files() {
        let count = 0;
        this.series.forEach((series) => {
            count += series.imageInstances.length;
        });
        return count;
    }

    pushFileHandle(seriesInstanceUid, modality, seriesDescription, fileHandle) {
        let dcmImageInstances = new DcmImageInstances(fileHandle);
        let series;
        if (this.series.has(seriesInstanceUid)) {
            series = this.series.get(seriesInstanceUid);
        } else {
            series = new DcmSeries(seriesInstanceUid, modality, seriesDescription);
        }
        if (typeof series !== "undefined") {
            series.pushImageInstances(dcmImageInstances);
            this.series.set(seriesInstanceUid, series);
            this.modality.add(modality);
        }

    }
}

class DcmFileSet {
    constructor() {
        this._count_in_proc = 0;
        this.number_of_files = 0;
        this.otherFiles = [];
        this.rejectedDICOM = [];
        this.studies = new Map();
    }

    getStudy(studyUid) {
        return this.studies.get(studyUid);
    }

    /**
     * Прочитать файл по дескриптору и добавить его в набор.
     * @param {FileSystemFileHandle} fileHandle - Дескриптор файла в файловой системе.
     * @param {Set<string>} modalityFilter - Множество ограничивающее модальности, которые разрешено отправлять на сервер. По умолчанию множество пустое - это соответствует отсутствию ограничений.
     */
    pushFileHandle(fileHandle, modalityFilter = new Set()) {
        if (fileHandle.name === undefined || fileHandle.getFile === undefined) {
            return;
        }
        this._count_in_proc += 1;
        this.number_of_files += 1;
        fileHandle.getFile()
            .then(async result => {
                const arrayBuffer = await result.arrayBuffer();
                const byteArray = new Uint8Array(arrayBuffer);
                const options = {
                    TransferSyntaxUID: '1.2.840.10008.1.2',
                    untilTag: 'x7fe00010'
                };
                const dataSet = window.dicomParser.parseDicom(byteArray, options);
                let studyInstanceUid = dataSet.string('x0020000d');
                let seriesInstanceUid = dataSet.string('x0020000e');
                let modality = dataSet.string('x00080060');

                if ((typeof studyInstanceUid === "undefined") || (typeof seriesInstanceUid === "undefined") || (typeof modality === "undefined")) {
                    this.otherFiles.push(fileHandle);
                    this._count_in_proc -= 1;
                    return;
                }
                if (modalityFilter.size !== 0) {
                    if (!modalityFilter.has(modality)) {
                        // Если модальность не содержится в списке разрешенных модальностей
                        this.rejectedDICOM.push(fileHandle);
                        this._count_in_proc -= 1;
                        return;
                    }
                }
                let studyDate = dataSet.string('x00080020');
                if (typeof studyDate === "undefined") {
                    studyDate = "";
                }

                let studyDescription = dataSet.string('x00081030');
                if (typeof studyDescription === "undefined") {
                    studyDescription = "";
                }
                let seriesDescription = dataSet.string('x0008103E');
                if (typeof seriesDescription === "undefined") {
                    seriesDescription = "";
                }
                let study;
                if (this.studies.has(studyInstanceUid)) {
                    study = this.studies.get(studyInstanceUid);
                } else {
                    study = new DcmStudy(
                        this.studies.size + 1,
                        studyInstanceUid,
                        studyDate,
                        studyDescription,
                        modality
                    );
                }
                if (typeof study !== "undefined") {
                    study.pushFileHandle(seriesInstanceUid, modality, seriesDescription, fileHandle);
                    this.studies.set(studyInstanceUid, study);
                }
                this._count_in_proc -= 1;
            })
            .catch(err => {
                console.error("[DcmFileSet::pushFileHandle] err:" + err.message);
                this.otherFiles.push(fileHandle);
                this._count_in_proc -= 1;
            })
    }
}

class WorkFlowState {
    // Ожидает выбора папки пользователем.
    static WaitsForFolderSelection = new WorkFlowState("waits_for_folder_selection")
    // Ожидает начала процесса сканирования папки на наличие DICOM файлов.
    static StartingScanningProcess = new WorkFlowState("starting_scanning_process")
    // Ожидает окончания процесса сканирования папки.
    static WaitsForScanningToComplete = new WorkFlowState("waits_for_scanning_to_complete")
    // Сканирование папки выполнено. Ожидаем выбора Исследований.
    static ScanningCompletedAndWaitStudyToBeSelected = new WorkFlowState("scanning_completed_and_wait_study_to_be_selected")
    // Ожидает начала процесса сканирования папки на наличие DICOM файлов.
    static StartingSendingProcess = new WorkFlowState("starting_sending_process")
    // Ожидает окончания процесса деперсонализации данных и отправки на сервер.
    static WaitsForSendToComplete = new WorkFlowState("waits_for_send_to_complete")
    // Отправка выполнена успешно.
    static SendingCompleted = new WorkFlowState("sending_completed")
    static ProcFailed = new WorkFlowState("proc_failed")
    static FileSystemAPINotSupported = new WorkFlowState("file_system_api_not_supported")

    constructor(name) {
        this.name = name
    }
}


class WorkFlow {
    /**
     * Инициировать процесс поиска и отправки файла.
     * @param {HTMLElement} targetEl - HTML элемент внутрь которого будет выполнен рендер интерфейса.
     * @param {Set<string>} modalityFilter - Множество ограничивающее модальности, которые разрешено отправлять на сервер. По умолчанию множество пустое - это соответствует отсутствию ограничений.
     * @param {integer} limitOnNumberOfStudies - Ограничение на количество исследований входящих в заказ. По умолчанию 1. Значение 0 соответствует отсутствию ограничений.
     * @param {Function} callbackSendSuccessfulResult - Функция, которая вызывается после успешного выполнения процесса отправки файлов и возвращает объект с метаинформацией об исследовании.
     * @param {string} urlForPostRequest - Url адрес для выполнения пост запроса.
     */
    constructor({
                    targetEl,
                    modalityFilter = new Set(),
                    limitOnNumberOfStudies = 1,
                    callbackSendSuccessfulResult = () => {
                    },
                    urlForPostRequest = ""
                }) {
        // Url адрес для выполнения пост запроса.
        this._urlForPostRequest = urlForPostRequest;
        // Множество ограничивающее модальности, которые разрешено отправлять на сервер.
        this._modalityFilter = modalityFilter;
        // Ограничение на количество исследований входящих в заказ.
        // По умолчанию 0 соответствует отсутствию ограничений.
        this._limitOnNumberOfStudies = limitOnNumberOfStudies;
        // Функция, которая вызывается после успешного выполнения процесса отправки файлов.
        this._callbackSendSuccessfulResult = callbackSendSuccessfulResult;
        // Целевой элемент на который будет отображен интерфейс.
        this.targetEl = targetEl;
        // Объект описывающий все найденные dicom файлы.
        this.dcmFileSet = new DcmFileSet();
        // Текущее состояние процесса.
        if (isDirectoryPickerAvailable()) {
            this._state = WorkFlowState.WaitsForFolderSelection;
        } else {
            this._state = WorkFlowState.FileSystemAPINotSupported;
        }
        // Дескриптор директории которую выбрал пользователь.
        this._currentDirHandle = undefined;
        // Генератор, который возвращает новый дескриптор к файлу расположенному в указанной папки и содержащихся в ней папках.
        this._genNextFileHandle = undefined;
        // Флаг для прерывания процесса сканирования.
        this._breakScan = false;
        // Флаг для прерывания процесса отправки.
        this._breakSend = false;
        // Множество строк с идентификаторами выбранных пользователем исследований для отправки.
        this._selectedStudies = new Set();
        // Текст сообщения ошибки, если такая имеется.
        this._failText = "";
        // Объект с метаинформацией об успешно отправленных исследованиях.
        // ```
        // obj = {
        //     "StudyInstanceUID1":{
        //         "SeriesInstanceUID1.1":[
        //             "SOPInstanceUID1.1.1",
        //             "SOPInstanceUID1.1.2",
        //             "SOPInstanceUID1.1.3"
        //         ],
        //         "SeriesInstanceUID1.2":[
        //             "SOPInstanceUID1.2.1",
        //             "SOPInstanceUID1.2.2",
        //             "SOPInstanceUID1.2.3"
        //         ]
        //     },
        //     "StudyInstanceUID2":{
        //         "SeriesInstanceUID2.1":[
        //             "SOPInstanceUID2.1.1",
        //             "SOPInstanceUID2.1.2",
        //             "SOPInstanceUID2.1.3"
        //         ]
        //     }
        // }
        // ```
        this._successfulSendDICOMInfo = new Map();
    }

    get numberOfSuccessfullySentDICOM() {
        try {
            let count = 0;
            for (const study of this._successfulSendDICOMInfo.values()) {
                for (const series of study.values()) {
                    count += series.length
                }
            }
            return count
        } catch (err) {
            console.error(err.message)
            return 0;
        }
    }

    get numberOfDICOMToSend() {
        return this.selectedImageInstances.length;
    }

    set state(newState) {
        switch (typeof newState) {
            case "object":
                this._state = newState;
                switch (this._state.name) {
                    case "waits_for_folder_selection":
                        this._breakScan = true;
                        this._currentDirHandle = undefined;
                        this.dcmFileSet = new DcmFileSet();
                        this._selectedStudies = new Set();
                        this._genNextFileHandle = undefined;
                        break;
                    case "starting_scanning_process":
                        this._breakScan = false;
                        this._selectedStudies = new Set();
                        this._genNextFileHandle = getFileHandlesByDirHandle(this.currentDirHandle);
                        this.startScanningProcess(10);
                        break;
                    case "waits_for_scanning_to_complete":
                        break;
                    case "scanning_completed_and_wait_study_to_be_selected":
                        this._breakSend = true;
                        this._selectedStudies = new Set();
                        break;
                    case "starting_sending_process":
                        this._breakSend = false;
                        this.startSendingProcess();
                        break;
                    case "waits_for_send_to_complete":
                        this._breakSend = false;
                        break;
                    case "sending_completed":
                        if (typeof this._callbackSendSuccessfulResult === "function") {
                            let temp2 = Object.fromEntries(this._successfulSendDICOMInfo);
                            for (const study in temp2) {
                                temp2[study] = Object.fromEntries(temp2[study]);
                            }
                            try {
                                this._callbackSendSuccessfulResult(temp2);
                            } catch (err) {
                                console.error("[callbackSendSuccessfulResult] Обратный вызов вернул: " + err.message)
                            }
                        }
                        break;
                    case "proc_failed":
                        this._breakScan = true;
                        this._breakSend = true;
                        this._selectedStudies = new Set();
                        this._successfulSendDICOMInfo = new Map();
                        break;
                    case "file_system_api_not_supported":
                        break;
                    default:
                        break;
                }
                break;
            default:
                this._state = undefined;
                break;
        }
        this.view();
    }

    get state() {
        return this._state;
    }

    // Прервать сканирование папки и установить состояние на "выбор папки".
    resetSelectedFolder() {
        this._breakScan = true;
        this.state = WorkFlowState.WaitsForFolderSelection;
    }

    // Прервать отправку снимков и установить состояние на выбор исследований.
    resetSelectedStudies() {
        this._breakScan = true;
        this.state = WorkFlowState.ScanningCompletedAndWaitStudyToBeSelected;
    }

    changeStateToWaitsForSend() {
        if (this.selectedStudies.size !== 0) {
            this.state = WorkFlowState.StartingSendingProcess;
        } else {
            alert("Необходимо выбрать не менее одного исследования, чтобы продолжить.");
        }
    }

    changeStateToProcFailed(msg) {
        this._breakScan = true;
        this._breakSend = true;
        this._failText = msg;
        this.state = WorkFlowState.ProcFailed;
    }


    changeStateToSendingCompleted() {
        this.state = WorkFlowState.SendingCompleted;
    }

    changeCurrentDirHandle(val) {
        switch (typeof val) {
            case "undefined":
                this._currentDirHandle = val;
                this.state = WorkFlowState.FileSystemAPINotSupported;
                break;
            case "string":
                this._currentDirHandle = undefined;
                this.state = WorkFlowState.ProcFailed;
                break;
            case "object":
                this._currentDirHandle = val;
                this.state = WorkFlowState.StartingScanningProcess;
                break;
        }
    }

    selectStudy(val) {
        if (val instanceof Set) {
            this.selectedStudies = val;
        }
    }

    get selectedStudies() {
        return this._selectedStudies;
    }

    set selectedStudies(val) {
        this._selectedStudies = val;
    }

    get currentDirHandle() {
        return this._currentDirHandle
    }

    get selectedImageInstances() {
        let imageInstances = [];
        for (const studyUid of this.selectedStudies) {
            const study = this.dcmFileSet.getStudy(studyUid);
            if (typeof study === "undefined") {
                continue;
            }
            imageInstances = imageInstances.concat(study.imageInstances);
        }
        return imageInstances
    }

    // Запустить процесс деперсонализации и отправки файлов.
    startSendingProcess() {
        const urlForPostRequest = this._urlForPostRequest;

        async function* getGenerator(items, afn) {
            for (const item of items) {
                if (this.state === WorkFlowState.ProcFailed) {
                    return;
                }
                yield await afn(item.fileHandle, urlForPostRequest);
            }
        }

        const gen = getGenerator.bind(this)(this.selectedImageInstances, anonymizeDataSetAndSendToUrl);
        const start = setInterval(() => {
            if (this._breakSend) {
                clearInterval(start);
                this._breakSend = false;
                this.state = WorkFlowState.ScanningCompletedAndWaitStudyToBeSelected;
            }
            gen.next()
                .then(result => {
                    if (result.done) {
                        clearInterval(start);
                        if (this.state === WorkFlowState.WaitsForSendToComplete) {
                            this.changeStateToSendingCompleted();
                        } else if (this.state === WorkFlowState.SendingCompleted) {}
                        else {
                            this.changeStateToProcFailed("Ой! Похоже, что-то сломалось.");
                        }
                    } else {
                        const res = result.value;
                        if ("isSuccessful" in res) {
                            if (res.isSuccessful && "data" in res) {
                                const studyInstanceUid = res.data.studyInstanceUid;
                                const seriesInstanceUid = res.data.seriesInstanceUid;
                                const sopInstanceUid = res.data.sopInstanceUid;
                                let studyVal;
                                if (this._successfulSendDICOMInfo.has(studyInstanceUid)) {
                                    studyVal = this._successfulSendDICOMInfo.get(studyInstanceUid);
                                    let seriesVal;
                                    if (studyVal.has(seriesInstanceUid)) {
                                        seriesVal = studyVal.get(seriesInstanceUid);
                                        seriesVal.push(sopInstanceUid);
                                    } else {
                                        seriesVal = [sopInstanceUid];
                                    }
                                    studyVal.set(seriesInstanceUid, seriesVal);
                                } else {
                                    studyVal = new Map();
                                    studyVal.set(seriesInstanceUid, [sopInstanceUid]);
                                }
                                this._successfulSendDICOMInfo.set(studyInstanceUid, studyVal);
                                if (this._breakSend) {
                                    clearInterval(start);
                                    this._breakSend = false;
                                    this.state = WorkFlowState.ScanningCompletedAndWaitStudyToBeSelected;
                                } else {
                                    this.state = WorkFlowState.WaitsForSendToComplete;
                                }
                            } else {
                                clearInterval(start);
                                if ("msg" in res) {
                                    this.changeStateToProcFailed(res.msg);
                                } else {
                                    this.changeStateToProcFailed("Возникла непредвиденная ошибка.");
                                }
                                return;
                            }
                        } else {
                            clearInterval(start);
                            this.changeStateToProcFailed("Сбой в работе программы.");
                            return;
                        }
                        if (this._breakSend) {
                            clearInterval(start);
                            this._breakSend = false;
                            this.state = WorkFlowState.ScanningCompletedAndWaitStudyToBeSelected;
                        } else {
                            this.state = WorkFlowState.WaitsForSendToComplete;
                        }
                    }
                })
                .catch(err => {
                    clearInterval(start);
                    this.changeStateToProcFailed(err.message);
                })

        }, 10);
    }

    // Запустить процесс поиска DICOM исследований на диске.
    startScanningProcess(delay) {
        if (typeof this._genNextFileHandle !== "undefined") {
            const gen = this._genNextFileHandle;
            this.state = WorkFlowState.WaitsForScanningToComplete;
            const start = setInterval(() => {
                if (this._breakScan) {
                    clearInterval(start);
                    this._breakScan = false;
                    this.state = WorkFlowState.WaitsForFolderSelection;
                    return;
                }
                gen.next()
                    .then(result => {
                        if (result.done) {
                            if (this.dcmFileSet._count_in_proc <= 0) {
                                clearInterval(start);
                                this.state = WorkFlowState.ScanningCompletedAndWaitStudyToBeSelected;
                            }
                        } else {
                            this.dcmFileSet.pushFileHandle(result.value, this._modalityFilter);
                            if (!this._breakScan) {
                                this.state = WorkFlowState.WaitsForScanningToComplete;
                            } else {
                                clearInterval(start);
                                this._breakScan = false;
                                this.state = WorkFlowState.WaitsForFolderSelection;
                            }
                        }
                    })
                    .catch(err => {
                        clearInterval(start);
                        this.changeStateToProcFailed(err.message);
                    });
            }, delay)
        }
    }

    view() {
        switch (this.state.name) {
            case "waits_for_folder_selection":
                if (document.getElementById("waits_for_folder_selection") === null) {
                    this.targetEl.innerHTML = "";
                    this.targetEl.appendChild(this.getElFolderSelection());
                }
                break;
            case "starting_scanning_process":
                if (document.getElementById("starting_scanning_process") === null) {
                    this.targetEl.innerHTML = "";
                    this.targetEl.appendChild(this.getElInfo(
                        "starting_scanning_process",
                        "Ожидайте",
                        "Начинаем сканирование папки."
                    ));
                }
                break;
            case "waits_for_scanning_to_complete":
                if (document.getElementById("waits_for_scanning_to_complete") === null) {
                    this.targetEl.innerHTML = "";
                    this.targetEl.appendChild(this.getElCurrentScanStatus());
                } else {
                    const oldEl = document.getElementById("currentNumberOfFilesThatHaveBeenScanned");
                    if (oldEl !== null) {
                        const el = CurrentNumberOfFilesThatHaveBeenScannedText(this.dcmFileSet.number_of_files);
                        oldEl.replaceWith(el);
                    }
                }
                break;
            case "scanning_completed_and_wait_study_to_be_selected":
                if (document.getElementById("scanning_completed_and_wait_study_to_be_selected") === null) {
                    this.targetEl.innerHTML = "";
                    this.targetEl.appendChild(this.getElScanCompleted());
                }
                break;
            case "starting_sending_process":
                if (document.getElementById("starting_sending_process") === null) {
                    this.targetEl.innerHTML = "";
                    this.targetEl.appendChild(this.getElInfo(
                        "starting_sending_process",
                        "Ожидайте",
                        "Начинаем отправку файлов."
                    ));
                }
                break;
            case "waits_for_send_to_complete":
                if (document.getElementById("waits_for_send_to_complete") === null) {
                    this.targetEl.innerHTML = "";
                    this.targetEl.appendChild(this.getElCurrentSendStatus(
                        this.numberOfSuccessfullySentDICOM,
                        this.numberOfDICOMToSend
                    ));
                } else {
                    const oldEl = document.getElementById("currentProgressSendText");
                    if (oldEl !== null) {
                        const el = CurrentProgressSendText(
                            this.numberOfSuccessfullySentDICOM,
                            this.numberOfDICOMToSend
                        );
                        oldEl.replaceWith(el);
                    }
                }
                break;
            case "sending_completed":
                if (document.getElementById("sending_completed") === null) {
                    this.targetEl.innerHTML = "";
                    this.targetEl.appendChild(this.getElSendingCompleted());
                }
                break;
            case "proc_failed":
                if (document.getElementById("proc_failed") === null) {
                    this.targetEl.innerHTML = "";
                    this.targetEl.appendChild(this.getElProcFailed());
                }
                break;
            case "file_system_api_not_supported":
                // Ваш браузер не поддерживает работу с файловой системой.
                if (document.getElementById("file_system_api_not_supported") === null) {
                    this.targetEl.innerHTML = "";
                    this.targetEl.appendChild(this.getElFileSystemAPINotSupported());
                }
                break;
            default:
                this.targetEl.innerHTML = "Ошибка...";
                break;
        }
    }

    // Вернуть html элемент с блоком содержащим кнопку для выбора папки.
    getElFolderSelection() {
        const callBack = this.changeCurrentDirHandle.bind(this);
        const changeStateToProcFailed = this.changeStateToProcFailed.bind(this);
        return TemplateCardBlock({
            id: "waits_for_folder_selection",
            title: "Выбор папки с мед.изображениями.",
            info: "Выберите папку в которой будет выполнен поиск всех медицинских изображений.",
            textBtnNext: "Выбрать папку",
            callbackNext: async function () {
                try {
                    const val = await selectFolder();
                    callBack(val);
                } catch (e) {
                    changeStateToProcFailed(e.message);
                }
            }
        });
    }

    // Вернуть html элемент с блоком отображения текущего статуса сканирования папки.
    getElCurrentScanStatus() {
        const el = CurrentNumberOfFilesThatHaveBeenScannedText(0);
        return TemplateCardBlock({
            id: "waits_for_scanning_to_complete",
            title: "Выполняется поиск файлов.",
            info: "Выполняется поиск..",
            activeEl: [el],
            textBtnPrevious: "Прервать",
            callbackPrevious: this.resetSelectedFolder.bind(this)
        });
    }

    getElScanCompleted() {
        const callback = this.selectStudy.bind(this);
        let subInfo = "";
        if (this._limitOnNumberOfStudies != 0) {
            subInfo = "(не более " + this._limitOnNumberOfStudies + ")"
        }
        return TemplateCardBlock({
            id: "scanning_completed_and_wait_study_to_be_selected",
            title: "Выбор исследования " + subInfo,
            info: "Выберете исследование которое необходимо отправить на обработку. Будет запущена процедура деперсонализации (удаление персональных данных из тегов) и отправка медицинских изображений на сервер обработки данных.",
            activeEl: [DcmStudySetBlock(this.dcmFileSet, callback, this._limitOnNumberOfStudies)],
            textBtnPrevious: "Назад",
            callbackPrevious: this.resetSelectedFolder.bind(this),
            textBtnNext: "Отправить",
            callbackNext: this.changeStateToWaitsForSend.bind(this)
        });
    }

    // Информационный блок.
    getElInfo(id, title, text) {
        const el = document.createElement("div");
        const failText = document.createTextNode(this._failText);
        el.appendChild(failText);
        el.classList.add("alert", "alert-info");
        el.setAttribute("role", "alert");
        return TemplateCardBlock({
            id: id,
            title: title,
            info: text,
            activeEl: [],
        });
    }

    // Вернуть html элемент с блоком отображения ошибки возникшей в ходе сканирования папки.
    getElProcFailed() {
        const el = document.createElement("div");
        const failText = document.createTextNode(this._failText);
        el.appendChild(failText);
        el.classList.add("alert", "alert-danger");
        el.setAttribute("role", "alert");
        return TemplateCardBlock({
            id: "proc_failed",
            title: "Ошибка.",
            info: "Попробуйте повторно выполнить поиск или обратиться в техническую поддержку.",
            activeEl: [el],
            textBtnPrevious: "Назад",
            callbackPrevious: this.resetSelectedFolder.bind(this),
        });
    }

    // Вернуть html элемент с блоком отображения ошибки возникшей в ходе сканирования папки.
    getElSendingCompleted() {
        const el = document.createElement("div");
        const text = document.createTextNode("Все исследования успешно были загружены на сервер обработки данных.");
        el.appendChild(text);
        el.classList.add("alert", "alert-success");
        el.setAttribute("role", "alert");
        return TemplateCardBlock({
            id: "sending_completed",
            title: "Исследования отправлены.",
            info: "",
            activeEl: [el],
        });
    }

    // Вернуть html элемент с блоком сообщения, что браузер не поддерживает работу с файловой системой.
    getElFileSystemAPINotSupported() {
        return TemplateCardBlock({
            id: "proc_failed",
            title: "Браузер не поддерживается.",
            info: "Ваш браузер не поддерживает работу с файловой системой.",
        });
    }

    // Вернуть html элемент с блоком отображения текущего статуса деперсонализации и отправки файла.
    getElCurrentSendStatus(count, total) {
        const el = CurrentProgressSendText(count, total);
        return TemplateCardBlock({
            id: "waits_for_send_to_complete",
            title: "Выполняется отправка на сервер.",
            info: "Выполняется деперсонализация файлов и их отправка на сервер.",
            activeEl: [el],
            textBtnPrevious: "Прервать",
            callbackPrevious: this.resetSelectedStudies.bind(this)
        });
    }
}

